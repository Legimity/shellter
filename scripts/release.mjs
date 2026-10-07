import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const name = `shellter-${source.version}-node24`;
const files = {};
async function include(relative) {
  const path = join(root, relative),
    stat = await lstat(path);
  if (stat.isSymbolicLink())
    throw new Error("Release inputs must not be symlinks");
  if (stat.isDirectory()) {
    for (const child of (await readdir(path)).sort())
      await include(relative + "/" + child);
  } else if (stat.isFile())
    files[name + "/" + relative] = new Uint8Array(await readFile(path));
  else throw new Error("Unexpected release input");
}
await include("dist/cli.js");
await include("dist/web");
await include("scripts/demo.mjs");
await include("docs/CLI.md");
await include("docs/RELEASE-NOTES.md");
await include("docs/GETTING-STARTED.md");
await include("docs/GETTING-STARTED.zh-CN.md");
await include("docs/DEMO.md");
await include("docs/COMPATIBILITY.md");
await include("docs/REAL-MIGRATION.md");
await include("docs/REMOTE-MIGRATION.md");
await include("docs/assets");
files[name + "/docs/COMPATIBILITY.md"] = strToU8(
  (await readFile(join(root, "docs/COMPATIBILITY.md"), "utf8")).replace(
    "For detailed implementation evidence and remaining work, see [development documentation](DEVELOPMENT.md). For commands, see the [CLI guide](CLI.md).",
    "For commands, see the [CLI guide](CLI.md).",
  ),
);
await include("LICENSE");
await include("THIRD-PARTY-NOTICES.txt");
const manifest = {
  name: source.name,
  version: source.version,
  license: source.license,
  private: true,
  type: "module",
  description: source.description,
  engines: source.engines,
  bin: source.bin,
  dependencies: source.dependencies,
  repository: source.repository,
  bugs: source.bugs,
  homepage: source.homepage,
  scripts: {
    start: "node dist/cli.js serve",
    cli: "node dist/cli.js",
    demo: "node scripts/demo.mjs",
    "demo:walkthrough": "node scripts/demo.mjs --walkthrough",
  },
};
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
delete lock.packages[""].devDependencies;
files[name + "/package.json"] = strToU8(
  JSON.stringify(manifest, null, 2) + "\n",
);
files[name + "/package-lock.json"] = strToU8(
  JSON.stringify(lock, null, 2) + "\n",
);
files[name + "/README.md"] = strToU8(
  `# Shellter ${source.version}\n\nA portable home for your AI coding agents.\n\nRequires Node.js 24 and npm. From this extracted directory:\n\n\`\`\`bash\nnpm ci --omit=dev\nnpm run demo\n\`\`\`\n\nOpen the localhost link and follow the [first-run guide](docs/GETTING-STARTED.md). The demo uses temporary files. Stop it with Ctrl+C, then run \`npm start\` to select your own configurations. No source build is required.\n\n[简体中文](README.zh-CN.md) · [CLI](docs/CLI.md) · [Compatibility](docs/COMPATIBILITY.md) · [Release notes](docs/RELEASE-NOTES.md) · [Report an issue](https://github.com/Legimity/shellter/issues/new/choose)\n\n[MIT license](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES.txt)\n`,
);
files[name + "/README.zh-CN.md"] = strToU8(
  `# Shellter ${source.version}\n\n给你的 agents，一个能带走的家。\n\n需要 Node.js 24 和 npm。解压后在此目录执行：\n\n\`\`\`bash\nnpm ci --omit=dev\nnpm run demo\n\`\`\`\n\n打开终端打印的本地链接，按[新手指南](docs/GETTING-STARTED.zh-CN.md)体验临时示例。停止示例后运行 \`npm start\`，选择自己的配置。无需构建源码。\n\n[English](README.md) · [CLI](docs/CLI.md) · [兼容范围](docs/COMPATIBILITY.md) · [反馈问题](https://github.com/Legimity/shellter/issues/new/choose)\n\n[MIT 许可](LICENSE) · [第三方许可声明](THIRD-PARTY-NOTICES.txt)\n`,
);
const output = join(root, "artifacts");
await mkdir(output, { recursive: true });
const bytes = zipSync(files, { level: 6 });
const archive = join(output, name + ".zip");
await writeFile(archive, bytes);
const checksum = createHash("sha256").update(bytes).digest("hex");
await writeFile(archive + ".sha256", checksum + "  " + name + ".zip\n");
console.log(
  JSON.stringify(
    {
      archive,
      checksum,
      entries: Object.keys(files).length,
      distribution:
        "Node 24 prebuilt package; runtime npm dependencies required",
      published: false,
    },
    null,
    2,
  ),
);
