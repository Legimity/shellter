import { assertPortable } from "./policy";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { zipSync, Unzip, UnzipInflate, strToU8, strFromU8 } from "fflate";
import { type Harness, harnessSchema, ShellterError } from "./model";
import {
  hash,
  portableFile,
  fail,
  checkedJson,
  checkPath,
  hasSecret,
} from "./security";
const maximum = 32 * 1024 * 1024;
export async function exportBundle(path: string, harness: Harness) {
  assertPortable(harness);
  const files: Record<string, Uint8Array> = {};
  const checksums: Record<string, string> = {};
  const resources = harness.resources.map((r) => {
    for (const [name, content] of Object.entries(r.files)) {
      const entry = "resources/" + r.id + "/" + portableFile(name);
      files[entry] = strToU8(content);
      checksums[entry] = hash(files[entry]);
    }
    return { ...r, files: {} };
  });
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        formatVersion: 1,
        producer: "shellter/0.1.0",
        harness: { formatVersion: 1, resources },
        checksums,
      },
      null,
      2,
    ),
  );
  const total = Object.values(files).reduce((s, v) => s + v.length, 0);
  if (total > maximum || Object.keys(files).length > 1000)
    fail("oversized", "包大小或条目数超限。");
  const data = zipSync(files, { level: 6 });
  await checkPath(path);
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  return {
    path,
    resources: resources.length,
    checksum: hash(data),
    excluded: "凭据、认证状态、运行时和本机备份不入包。",
  };
}
function inspectZip(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) fail("invalid-bundle", "ZIP 缺少目录。");
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (
    count > 1000 ||
    offset >= data.length ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    fail("invalid-bundle", "不支持分卷或超限包。");
  let pos = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > data.length || view.getUint32(pos, true) !== 0x02014b50)
      fail("invalid-bundle", "ZIP 目录损坏。");
    const compressed = view.getUint32(pos + 20, true),
      size = view.getUint32(pos + 24, true),
      length = view.getUint16(pos + 28, true),
      extra = view.getUint16(pos + 30, true),
      comment = view.getUint16(pos + 32, true),
      mode = view.getUint32(pos + 38, true) >>> 16;
    if (pos + 46 + length + extra + comment > data.length)
      fail("invalid-bundle", "ZIP 目录越界。");
    const name = strFromU8(data.subarray(pos + 46, pos + 46 + length));
    portableFile(name);
    if (
      names.has(name) ||
      (mode & 0xf000) === 0xa000 ||
      ((mode & 0xf000) !== 0 && (mode & 0xf000) !== 0x8000)
    )
      fail("unsafe-path", "ZIP 包含重复条目或非普通文件。");
    names.add(name);
    total += size;
    if (
      total > maximum ||
      size > 4 * 1024 * 1024 ||
      size > Math.max(compressed, 1) * 200 ||
      size === 0xffffffff
    )
      fail("oversized", "ZIP 解压资源超限。");
    pos += 46 + length + extra + comment;
  }
  return names;
}
export async function importBundle(path: string): Promise<Harness> {
  await checkPath(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maximum)
    fail("oversized", "输入包过大或不是普通文件。");
  const data = new Uint8Array(await readFile(path));
  const expected = inspectZip(data);
  const unpacked: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  const unzip = new Unzip((file) => {
    portableFile(file.name);
    if (!expected.has(file.name) || Object.hasOwn(unpacked, file.name))
      fail("invalid-bundle", "解包目录不一致。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      if (size > 4 * 1024 * 1024 || total > maximum) {
        file.terminate();
        fail("oversized", "实际解压内容超限。");
      }
      chunks.push(chunk);
      if (final) {
        const content = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          content.set(part, offset);
          offset += part.length;
        }
        unpacked[file.name] = content;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < data.length; offset += 1024)
      unzip.push(
        data.subarray(offset, offset + 1024),
        offset + 1024 >= data.length,
      );
  } catch (error) {
    if (error instanceof ShellterError) throw error;
    fail("invalid-bundle", "ZIP 无法安全解压。");
  }
  if (Object.keys(unpacked).length !== expected.size)
    fail("invalid-bundle", "解压条目不一致。");
  const m = unpacked["manifest.json"];
  if (!m) fail("invalid-bundle", "缺少 manifest。");
  let manifest: {
    formatVersion: number;
    producer: string;
    harness: unknown;
    checksums: Record<string, string>;
  };
  try {
    manifest = JSON.parse(strFromU8(m));
  } catch {
    fail("invalid-bundle", "manifest 非法。");
  }
  if (
    manifest.formatVersion !== 1 ||
    !manifest.checksums ||
    typeof manifest.checksums !== "object"
  )
    fail("unsupported-version", "不支持该包格式版本。");
  const harness = checkedJson(manifest.harness, harnessSchema.parse);
  const ids = new Set(harness.resources.map((r) => r.id));
  if (ids.size !== harness.resources.length)
    fail("invalid-bundle", "重复资源 ID。");
  for (const [name, bytes] of Object.entries(unpacked)) {
    if (name === "manifest.json") continue;
    const match = /^resources\/([a-zA-Z0-9_-]+)\/(.+)$/.exec(name);
    if (
      !match ||
      !ids.has(match[1]) ||
      manifest.checksums[name] !== hash(bytes)
    )
      fail("invalid-bundle", "资源或校验摘要不匹配。");
    const content = strFromU8(bytes);
    if (hash(strToU8(content)) !== hash(bytes))
      fail("unsupported", "暂不导入无法审查的二进制附件。");
    harness.resources.find((r) => r.id === match[1])!.files[
      portableFile(match[2])
    ] = content;
  }
  if (Object.keys(manifest.checksums).some((n) => !unpacked[n]))
    fail("invalid-bundle", "资源缺失。");
  if (hasSecret(harness)) fail("secret", "包中存在凭据或疑似秘密，未导入。");
  assertPortable(harness);
  return harness;
}
