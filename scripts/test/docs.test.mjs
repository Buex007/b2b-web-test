// docs.test.mjs — keep the two READMEs from drifting apart.
//
// Bilingual docs rot in a specific way: one language gets the new section and
// the other quietly keeps the old structure. Comparing section counts and
// cross-links catches that without pinning any wording.

import { test, assert, assertEq, assertMatch, testCount } from "./harness.mjs";
import { readText, nodePath } from "../lib/util.mjs";

const SKILL_ROOT = new URL(".", import.meta.url).pathname.replace(/\/scripts\/test\/$/, "");
const path = await nodePath();

const read = (f) => readText(path.join(SKILL_ROOT, f));
const h2s = (text) => text.split("\n").filter((l) => /^## /.test(l)).length;

test("both READMEs exist and link to each other", async () => {
  const zh = await read("README.md");
  const en = await read("README.en.md");
  assertMatch(zh, /\[English\]\(README\.en\.md\)/, "Chinese README must link to the English one");
  assertMatch(en, /\[中文\]\(README\.md\)/, "English README must link to the Chinese one");
});

test("the two READMEs stay structurally in sync", async () => {
  const zh = await read("README.md");
  const en = await read("README.en.md");
  assertEq(h2s(zh), h2s(en), "same number of top-level sections in both languages");
  assert(h2s(zh) >= 8, `expected the full README structure, found ${h2s(zh)} sections`);
  // Both must carry the measured numbers, not just one of them.
  for (const [name, text, needle] of [
    ["README.md", zh, "9,016"],
    ["README.en.md", en, "9,016"],
    ["README.md", zh, "DeepSeek v4.1 Flash"],
    ["README.en.md", en, "DeepSeek v4.1 Flash"],
  ]) {
    assert(text.includes(needle), `${name} must state ${needle}`);
  }
  // The project publishes measured usage only — no price claim. This guard
  // exists because a cost figure was added and then deliberately removed.
  for (const [name, text] of [
    ["README.md", zh],
    ["README.en.md", en],
  ]) {
    for (const banned of ["¥", "0.2 元", "2 毛", "$0.2"]) {
      assert(!text.includes(banned), `${name} must not carry a price claim (${banned})`);
    }
  }
  // Both must state the honest caveat about what drives token use.
  assert(zh.includes("候选元素"), "Chinese README must explain the token caveat");
  assert(en.toLowerCase().includes("candidate elements"), "English README must explain it too");
});

test("the test count quoted in the READMEs matches reality", async () => {
  // A stated test count is the kind of detail that silently goes stale. Both
  // READMEs must quote the real number, which is known once every test file
  // has been imported (that has already happened by the time this runs).
  const n = testCount();
  const zh = await read("README.md");
  const en = await read("README.en.md");
  assert(
    zh.includes(`${n} 项全部通过`),
    `README.md must state "${n} 项全部通过" (actual count: ${n})`,
  );
  assert(
    en.includes(`${n} / ${n} passing`),
    `README.en.md must state "${n} / ${n} passing" (actual count: ${n})`,
  );
});
