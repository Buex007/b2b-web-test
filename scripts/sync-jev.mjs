// sync-jev.mjs — check (or refresh) the vendored Jev loop against an installed
// copy of the ego-jev skill.
//
// Usage:
//   node scripts/sync-jev.mjs --check [--from <ego-jev skill dir>]
//   node scripts/sync-jev.mjs --update --from <ego-jev skill dir>

import { readText, writeText, readJson, nodePath, fs } from "./lib/util.mjs";

const args = process.argv.slice(2);
const wantUpdate = args.includes("--update");
const fromIdx = args.indexOf("--from");
const explicitFrom = fromIdx >= 0 ? args[fromIdx + 1] : null;

const here = new URL(".", import.meta.url).pathname;
const SKILL_ROOT = here.replace(/\/scripts\/$/, "");
const path = await nodePath();
const vendored = path.join(SKILL_ROOT, "scripts/vendored/jev-loop.mjs");
const provenancePath = path.join(SKILL_ROOT, "scripts/vendored/PROVENANCE.json");

async function sha256(file) {
  const { createHash } = await import("node:crypto");
  const f = await fs();
  const buf = await f.readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

async function candidates() {
  const out = [];
  if (explicitFrom) out.push(path.join(explicitFrom, "scripts/jev-loop.mjs"));
  const home = process.env.HOME || "";
  if (home) {
    out.push(path.join(home, ".codex/skills/ego-jev/scripts/jev-loop.mjs"));
    out.push(path.join(home, ".agents/skills/ego-jev/scripts/jev-loop.mjs"));
    out.push(path.join(home, ".claude/skills/ego-jev/scripts/jev-loop.mjs"));
  }
  return out;
}

const provenance = (await readJson(provenancePath, {})) || {};
const mine = await sha256(vendored);
console.log(`vendored: ${mine}`);
console.log(`recorded: ${provenance.sha256 || "(none)"}`);
if (provenance.sha256 && provenance.sha256 !== mine) {
  console.log("⚠️  vendored 文件与 PROVENANCE.json 记录不一致（本地被改过？）");
}

let upstream = null;
for (const c of await candidates()) {
  try {
    const f = await fs();
    await f.access(c);
    upstream = c;
    break;
  } catch {
    /* try the next location */
  }
}

if (!upstream) {
  console.log("找不到已安装的 ego-jev 技能；用 --from <目录> 指定。");
  process.exitCode = wantUpdate ? 1 : 0;
} else {
  const up = await sha256(upstream);
  console.log(`upstream: ${up}  (${upstream})`);
  if (up === mine) {
    console.log("✅ 与上游一致，无需同步。");
  } else if (wantUpdate) {
    await writeText(vendored, await readText(upstream));
    const next = { ...provenance, sha256: up, vendoredAt: new Date().toISOString().slice(0, 10) };
    await writeText(provenancePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log("✅ 已更新 vendored 副本，并刷新 PROVENANCE.json");
  } else {
    console.log("⚠️  上游已变化。`b2b-test` 行为不受影响，但请评估后执行：");
    console.log("    node scripts/sync-jev.mjs --update");
    process.exitCode = 1;
  }
}
