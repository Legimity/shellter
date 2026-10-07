import { readdir, readFile, access } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";

const roots = ["README.md", "README.zh-CN.md", "CONTRIBUTING.md", "SECURITY.md"];
for (const name of await readdir("docs")) {
  if (name.endsWith(".md")) roots.push(join("docs", name));
}
const failures = [];
for (const file of roots) {
  const body = await readFile(file, "utf8");
  for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    try {
      await access(resolve(dirname(file), target));
    } catch {
      failures.push(`${file}: ${match[1]}`);
    }
  }
}
if (failures.length) throw new Error("Missing document targets:\n" + failures.join("\n"));
console.log(`Checked relative links in ${roots.length} documents.`);
