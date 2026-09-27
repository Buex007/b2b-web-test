// license.test.mjs — keep the licence and the third-party attribution honest.
//
// Two things rot quietly here: the vendored file gets edited by accident (which
// breaks the byte-identical guarantee the attribution relies on), and the
// attribution wording drifts between LICENSE, the notices file and
// PROVENANCE.json. Both are checked below.

import { test, assert, assertEq, assertMatch } from "./harness.mjs";
import { readText, readJson, nodePath, fs } from "../lib/util.mjs";

const SKILL_ROOT = new URL(".", import.meta.url).pathname.replace(/\/scripts\/test\/$/, "");
const path = await nodePath();

const ATTRIBUTION =
  "MIT. Policy, snapshot, and question text are derived from jev-ultrafast (MIT, Browser Use).";

/** Collapse whitespace so a wrapped line still matches the canonical sentence. */
const flat = (s) => String(s).replace(/\s+/g, " ").trim();

test("LICENSE exists and is MIT", async () => {
  const text = await readText(path.join(SKILL_ROOT, "LICENSE"));
  assertMatch(text, /^MIT License$/m, "MIT heading");
  assertMatch(text, /Permission is hereby granted, free of charge/, "MIT body");
  assertMatch(text, /WITHOUT WARRANTY OF ANY KIND/, "MIT disclaimer");
  assertMatch(text, /Copyright \(c\) \d{4} /, "copyright line");
});

test("the upstream attribution appears verbatim in every place that claims it", async () => {
  const license = flat(await readText(path.join(SKILL_ROOT, "LICENSE")));
  const notices = flat(await readText(path.join(SKILL_ROOT, "THIRD-PARTY-NOTICES.md")));
  const provenance = await readJson(path.join(SKILL_ROOT, "scripts/vendored/PROVENANCE.json"));
  const readme = flat(await readText(path.join(SKILL_ROOT, "README.md")));

  assert(license.includes(ATTRIBUTION), "LICENSE must carry the upstream sentence");
  assert(notices.includes(ATTRIBUTION), "notices file must carry the upstream sentence");
  assertEq(provenance.attribution, ATTRIBUTION, "PROVENANCE.json must carry it exactly");
  assert(readme.includes(ATTRIBUTION), "README must carry it exactly");
  assertEq(provenance.license, "MIT", "PROVENANCE.json records the licence");
});

test("the vendored file is still byte-identical to what PROVENANCE.json records", async () => {
  const { createHash } = await import("node:crypto");
  const provenance = await readJson(path.join(SKILL_ROOT, "scripts/vendored/PROVENANCE.json"));
  const buf = await (await fs()).readFile(path.join(SKILL_ROOT, "scripts/vendored/jev-loop.mjs"));
  const sha = createHash("sha256").update(buf).digest("hex");
  assertEq(sha, provenance.sha256, "vendored hash must match the recorded one");
  // The notices file promises the file carries no extra header of ours.
  assertEq(provenance.modifications.startsWith("none"), true, "still unmodified");
});

test("the notices explain why the vendored file must not be annotated", async () => {
  const notices = await readText(path.join(SKILL_ROOT, "THIRD-PARTY-NOTICES.md"));
  assertMatch(notices, /不要给 vendored 文件加注释/, "warns against adding a header");
  assertMatch(notices, /sync-jev\.mjs --update/, "documents the upgrade path");
});
