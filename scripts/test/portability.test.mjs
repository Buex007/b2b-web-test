// portability.test.mjs — the guard rail for "works on any Mac, for any user".
//
// Scans the shipped files for the things that silently break portability:
// a hard-coded home directory, an ego-lite version pinned in code, or a
// coupling to one particular agent's directory layout.

import { test, assert } from "./harness.mjs";
import { readText, nodePath, listFiles, fs } from "../lib/util.mjs";

const SKILL_ROOT = (() => {
  // scripts/test/portability.test.mjs -> skill root
  const here = new URL(".", import.meta.url).pathname;
  return here.replace(/\/scripts\/test\/$/, "");
})();

const SKIP_DIRS = new Set(["vendored", "test", "node_modules", ".git"]);
// Development-time helpers are allowed to look in well-known locations —
// they probe several candidates and degrade gracefully. The *runtime* files
// (bin/, scripts/lib/, assets/) must not.
const SKIP_FILES = new Set(["scripts/sync-jev.mjs"]);
const TEXT_EXT = /\.(mjs|js|sh|md|json|html|txt|yaml|yml|env)$/;

async function walk(dir, out = []) {
  const path = await nodePath();
  const f = await fs();
  let entries = [];
  try {
    entries = await f.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(full, out);
    } else if (TEXT_EXT.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN = [
  { re: /\/Users\/[A-Za-z0-9._-]+/, why: "硬编码了某个用户的家目录" },
  { re: /\b0\.5\.1\.13\b/, why: "硬编码了 ego lite 版本号" },
  { re: /\.codex\/skills\/ego-jev/, why: "耦合到某个具体技能安装路径" },
];

test("no hard-coded user paths, versions or agent layouts", async () => {
  const files = await walk(SKILL_ROOT);
  assert(files.length > 5, `expected to scan the skill tree, found ${files.length} files`);
  const hits = [];
  for (const file of files) {
    const rel = file.replace(`${SKILL_ROOT}/`, "");
    if (SKIP_FILES.has(rel)) continue;
    const text = await readText(file);
    for (const { re, why } of FORBIDDEN) {
      const m = text.match(re);
      if (m) hits.push(`${file.replace(SKILL_ROOT, ".")}: ${why} → ${m[0]}`);
    }
  }
  assert(hits.length === 0, `\n     ${hits.join("\n     ")}`);
});

test("the launcher is POSIX sh and does not require jq/node/python", async () => {
  const path = await nodePath();
  const launcher = await readText(path.join(SKILL_ROOT, "bin/b2b-test"));
  const body = launcher
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert(!/\bcommand -v jq\b/.test(body), "must not depend on jq");
  assert(!/^\s*source\b/m.test(body), "use POSIX '.' instead of source");
  assert(!/\bpython3?\b/.test(body), "must not depend on python");
  // `[[:space:]]` inside a regex is fine; the bash `[[` test command is not.
  assert(!/\[\[(?!:)/.test(body), "avoid the non-POSIX [[ test");
});

test("every shipped lib is present and importable by relative path", async () => {
  const path = await nodePath();
  const libDir = path.join(SKILL_ROOT, "scripts/lib");
  const files = (await listFiles(libDir)).map((d) => path.basename(d));
  for (const expected of ["util.mjs", "recorder.mjs", "session.mjs", "jev.mjs", "report.mjs", "context.mjs", "helpers.mjs", "collectors.mjs", "mock-ask.mjs", "index.mjs"]) {
    assert(files.includes(expected), `missing scripts/lib/${expected}`);
  }
});

test("shell scripts brace every variable followed by a wide character", async () => {
  // On macOS /bin/sh (bash 3.2 in POSIX mode) `$VAR中文` swallows the
  // multibyte character into the variable name and dies with "unbound
  // variable". Only the braced form ${VAR}中文 is safe. This bites precisely
  // when the message is Chinese, which is most of them.
  const path = await nodePath();
  const targets = ["bin/b2b-test", "install.sh", "uninstall.sh"];
  const hits = [];
  for (const rel of targets) {
    const text = await readText(path.join(SKILL_ROOT, rel));
    text.split("\n").forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const m = line.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/);
      if (m) hits.push(`${rel}:${i + 1}: ${m[0]}`);
    });
  }
  assert(hits.length === 0, `\n     ${hits.join("\n     ")}`);
});

test("shell scripts avoid GNU-only sed/grep extensions", async () => {
  // macOS ships BSD sed and BSD grep. `\|` and `\+` in a basic regex are GNU
  // extensions that BSD sed treats as literals — it fails silently, which is
  // exactly how a "working" cleanup step keeps a stray quote and then makes a
  // backend guess wrong.
  const path = await nodePath();
  const targets = ["bin/b2b-test", "install.sh", "uninstall.sh"];
  const hits = [];
  for (const rel of targets) {
    const text = await readText(path.join(SKILL_ROOT, rel));
    text.split("\n").forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const badSed = /sed\b[^|]*[^\\]\\[|+?]/.test(line);
      const badGrep = /grep\b[^|]*-P\b/.test(line);
      const badSedR = /sed\s+-r\b/.test(line);
      if (badSed || badGrep || badSedR) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert(hits.length === 0, `\n     ${hits.join("\n     ")}`);
});
