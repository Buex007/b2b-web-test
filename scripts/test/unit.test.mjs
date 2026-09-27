// unit.test.mjs — pure-logic tests: no browser, no network, no API key.

import { test, assert, assertEq, assertMatch } from "./harness.mjs";
import {
  slugify,
  maskValue,
  fmtMs,
  listDirs,
  readJson,
  readJsonl,
  writeText,
  nodePath,
  fs,
} from "../lib/util.mjs";
import { newBatchId, createCaseDir, createRecorder, claimDir } from "../lib/recorder.mjs";
import { loadJob } from "../lib/context.mjs";
import { envSlugFor } from "../lib/session.mjs";
import { renderCase, renderBatch, renderDashboard, scanAll, toJUnit } from "../lib/report.mjs";
import { autoFormAsk, scriptedAsk } from "../lib/mock-ask.mjs";

const tmpRoot = await (async () => {
  const f = await fs();
  const os = await import("node:os");
  const path = await nodePath();
  const dir = await f.mkdtemp(path.join(os.tmpdir(), "b2b-test-"));
  return dir;
})();

let seq = 0;
async function freshDir(label) {
  const path = await nodePath();
  seq += 1;
  const dir = path.join(tmpRoot, `${String(seq).padStart(2, "0")}-${label}`);
  const f = await fs();
  await f.mkdir(dir, { recursive: true });
  return dir;
}

/** Minimal stand-in for an ego Page: enough for the recorder's evidence path. */
function fakePage({ url = "file:///fake", failShot = false } = {}) {
  const calls = { shots: [], evals: [] };
  return {
    calls,
    async url() {
      return url;
    },
    async screenshot({ path }) {
      if (failShot) throw new Error("no screenshot for you");
      calls.shots.push(path);
      const f = await fs();
      await f.writeFile(path, "PNG-STUB");
      return path;
    },
    async evaluate(fn) {
      calls.evals.push(String(fn).slice(0, 40));
      return null;
    },
  };
}

// ---------------------------------------------------------------- utilities
test("slugify keeps CJK, strips punctuation, bounds length", () => {
  assertEq(slugify("登录后新建订单 Test Case!"), "登录后新建订单-test-case");
  assertEq(slugify("   "), "case");
  assert(slugify("x".repeat(100)).length <= 40, "length bound");
});

test("maskValue never reveals the whole credential", () => {
  assertEq(maskValue("abc"), "****");
  const m = maskValue("sk-or-v1-abcdef123456");
  assert(!m.includes("abcdef123456"), "secret body must not survive masking");
});

test("fmtMs is readable across magnitudes", () => {
  assertEq(fmtMs(250), "250ms");
  assertEq(fmtMs(1500), "1.50s");
  assertMatch(fmtMs(90_000), /^1m30s$/);
});

// ------------------------------------------------------------------- batches
test("batch id is time-ordered and unique", () => {
  const a = newBatchId();
  const b = newBatchId();
  assertMatch(a, /^\d{8}-\d{6}-[a-z0-9]{4}$/, "format");
  assert(a !== b, "two ids in the same second must differ");
  // Ordering is driven by the second-resolution timestamp prefix; two ids made
  // within the same second are deliberately tie-broken at random.
  assert(a.slice(0, 15) <= b.slice(0, 15), "timestamp prefix must not go backwards");
  const later = newBatchId();
  assert(later.slice(0, 15) >= a.slice(0, 15), "prefix ordering holds over calls");
});

test("batch id carries a slugified label", () => {
  assertMatch(newBatchId({ label: "冒烟 Smoke" }), /-冒烟-smoke$/);
});

test("claimDir is exclusive when asked", async () => {
  const dir = await freshDir("claim");
  const path = await nodePath();
  const target = path.join(dir, "taken");
  assertEq(await claimDir(target, { exclusive: true }), target);
  assertEq(await claimDir(target, { exclusive: true }), null, "second claim must fail");
});

// ----------------------------------------------------------- case workspace
test("createCaseDir lays out the record before execution", async () => {
  const batchDir = await freshDir("batch");
  const created = await createCaseDir({
    batchDir,
    batchId: "20260927-120000-abcd-test",
    seq: 1,
    slug: "order-create",
    url: "https://example.com",
    description: "登录后新建订单",
    env: "staging",
    agent: "codex",
    engine: { ego: "ego-browser x", jev: "typesafe" },
  });
  const path = await nodePath();
  const f = await fs();
  for (const rel of ["case.md", "plan.md", "plan.mjs", "steps.jsonl", "result.json", "shots", "snapshots"]) {
    await f.access(path.join(created.caseDir, rel));
  }
  const result = await readJson(path.join(created.caseDir, "result.json"));
  assertEq(result.verdict, "running", "a fresh case is visibly unfinished");
  assertEq(result.description, "登录后新建订单", "the raw description is kept verbatim");
  const md = await (await fs()).readFile(path.join(created.caseDir, "case.md"), "utf8");
  assert(md.includes("登录后新建订单"), "case.md carries the original description");
});

test("second case in a batch does not collide with the first", async () => {
  const batchDir = await freshDir("batch2");
  const args = {
    batchDir,
    batchId: "20260927-120000-abcd-test",
    seq: 1,
    slug: "same-name",
    url: "https://example.com",
    description: "d",
    env: null,
    agent: null,
    engine: null,
  };
  const a = await createCaseDir(args);
  const b = await createCaseDir(args);
  assert(a.caseDir !== b.caseDir, "same slug must still get its own directory");
  assertMatch(b.caseId, /^02-/, "sequence increments");
});

// ---------------------------------------------------------------- recorder
test("recorder writes a timeline, verdict and evidence", async () => {
  const batchDir = await freshDir("rec-batch");
  const created = await createCaseDir({
    batchDir,
    batchId: "20260927-120000-abcd-rec",
    seq: 1,
    slug: "rec",
    url: "https://example.com",
    description: "记录测试",
    env: null,
    agent: "unit-test",
    engine: null,
  });
  const rec = createRecorder({
    dataDir: tmpRoot,
    batchDir,
    caseDir: created.caseDir,
    caseId: created.caseId,
    slug: "rec",
    batchId: "20260927-120000-abcd-rec",
    url: "https://example.com",
    description: "记录测试",
    env: null,
    agent: "unit-test",
    engine: null,
    options: { shots: "step" },
  });
  const page = fakePage();
  await rec.attach(page);
  await rec.step("第一步", { op: "goto" });
  await rec.note("说明文字");
  await rec.step("第二步", { op: "click" });
  await rec.check("检查通过", true, "理由");
  await rec.check("检查失败", false, "不该通过");
  const done = await rec.finish("fail", "第二条不通过");

  const path = await nodePath();
  const steps = await readJsonl(path.join(created.caseDir, "steps.jsonl"));
  assertEq(steps.length, 2, "two steps recorded");
  assertEq(steps[0].label, "第一步");
  assert(steps[0].detail.includes("说明文字"), "note lands on the step");
  assert(steps[1].status === "fail", "a failed check fails its step");
  assert(page.calls.shots.length >= 2, "per-step screenshots were taken");

  const result = await readJson(path.join(created.caseDir, "result.json"));
  assertEq(result.verdict, "fail");
  assertEq(result.steps, 2);
  assertEq(result.checks.length, 2);
  assert(result.shots.length >= 2, "shots are listed in the record");
  assertEq(done.verdict, "fail");
});

test("recorder finishes exactly once", async () => {
  const batchDir = await freshDir("rec-once");
  const created = await createCaseDir({
    batchDir,
    batchId: "20260927-120000-abcd-once",
    seq: 1,
    slug: "once",
    url: "https://example.com",
    description: "d",
    env: null,
    agent: null,
    engine: null,
  });
  const rec = createRecorder({
    dataDir: tmpRoot,
    batchDir,
    caseDir: created.caseDir,
    caseId: created.caseId,
    slug: "once",
    batchId: "20260927-120000-abcd-once",
    url: "https://example.com",
    description: "d",
    env: null,
    agent: null,
    engine: null,
    options: { shots: "off" },
  });
  await rec.finish("pass", "first");
  const second = await rec.finish("fail", "second");
  assert(second.alreadyFinished, "a second finish is a no-op");
  const path = await nodePath();
  const result = await readJson(path.join(created.caseDir, "result.json"));
  assertEq(result.verdict, "pass", "the first verdict survives");
});

test("recorder survives a page that cannot be screenshotted", async () => {
  const batchDir = await freshDir("rec-noshot");
  const created = await createCaseDir({
    batchDir,
    batchId: "20260927-120000-abcd-noshot",
    seq: 1,
    slug: "noshot",
    url: "https://example.com",
    description: "d",
    env: null,
    agent: null,
    engine: null,
  });
  const rec = createRecorder({
    dataDir: tmpRoot,
    batchDir,
    caseDir: created.caseDir,
    caseId: created.caseId,
    slug: "noshot",
    batchId: "20260927-120000-abcd-noshot",
    url: "https://example.com",
    description: "d",
    env: null,
    agent: null,
    engine: null,
    options: { shots: "step" },
  });
  await rec.attach(fakePage({ failShot: true }));
  await rec.step("截图失败也不能炸");
  const res = await rec.finish("pass", "ok");
  assertEq(res.verdict, "pass", "evidence failure must not change the verdict");
});

// ------------------------------------------------------------------ session
test("envSlugFor is stable and host-based", () => {
  assertEq(
    envSlugFor({ url: "https://crm.example.com/a/b", envName: "staging" }),
    "staging-crm-example-com",
  );
  assertEq(envSlugFor({ url: "not a url" }), "default");
});

// --------------------------------------------------------------------- jobs
test("loadJob parses the sh-written job file", async () => {
  const dir = await freshDir("job");
  const path = await nodePath();
  await writeText(
    path.join(dir, "job.env"),
    [
      "schema=1",
      "action=exec",
      "caseDir=/tmp/case dir", // a space must survive
      "url=https://x.test/a?b=c&d=e", // '=' inside a value must survive
      "optionsMock=1",
    ].join("\n") + "\n",
  );
  await writeText(path.join(dir, "description.txt"), "多行\n描述");
  const payload = await loadJob(dir);
  assertEq(payload.action, "exec");
  assertEq(payload.caseDir, "/tmp/case dir");
  assertEq(payload.url, "https://x.test/a?b=c&d=e");
  assertEq(payload.options.mock, true);
  assertEq(payload.description, "多行\n描述");
});

test("loadJob refuses a missing job file", async () => {
  const dir = await freshDir("job-missing");
  await (async () => {
    try {
      await loadJob(dir);
    } catch (err) {
      assertMatch(err.message, /job file unreadable/);
      return;
    }
    throw new Error("expected a rejection");
  })();
});

// ------------------------------------------------------------------ reports
test("report renders markdown, html and a scannable index", async () => {
  const dataDir = await freshDir("reports");
  const path = await nodePath();
  const batchId = "20260927-120000-abcd-rep";
  const batchDir = path.join(dataDir, "batches", batchId);
  const created = await createCaseDir({
    batchDir,
    batchId,
    seq: 1,
    slug: "报表",
    url: "https://example.com/x",
    description: "渲染报告",
    env: "uat",
    agent: "unit-test",
    engine: { ego: "ego-browser 0", jev: "mock" },
  });
  const rec = createRecorder({
    dataDir,
    batchDir,
    caseDir: created.caseDir,
    caseId: created.caseId,
    slug: "报表",
    batchId,
    url: "https://example.com/x",
    description: "渲染报告",
    env: "uat",
    agent: "unit-test",
    engine: { ego: "ego-browser 0", jev: "mock" },
    options: { shots: "off" },
  });
  await rec.attach(fakePage());
  await rec.step("记录一步");
  await rec.check("通过项", true, "ok");
  await rec.finish("pass", "一切正常");

  const f = await fs();
  const reportMd = await f.readFile(path.join(created.caseDir, "report.md"), "utf8");
  assert(reportMd.includes("通过"), "markdown carries the verdict");
  assert(reportMd.includes("记录一步"), "markdown carries the timeline");
  const reportHtml = await f.readFile(path.join(created.caseDir, "report.html"), "utf8");
  assert(reportHtml.includes("<!doctype html>"), "html report written");
  assert(!/https?:\/\/cdn/.test(reportHtml), "the viewer must not depend on a CDN");

  const scan = await scanAll({ dataDir });
  assertEq(scan.length, 1);
  assertEq(scan[0].cases.length, 1);

  const dash = await renderDashboard({ dataDir });
  assertEq(dash.cases, 1);
  const dashHtml = await f.readFile(path.join(dataDir, "reports", "index.html"), "utf8");
  assert(dashHtml.includes(batchId), "dashboard lists the batch");

  const junit = await toJUnit({ cases: scan[0].cases });
  assertMatch(junit, /<testsuite[^>]*tests="1"/);
  assertMatch(junit, /failures="0"/);
});

test("junit marks failures and human handoff correctly", async () => {
  const xml = await toJUnit({
    cases: [
      { result: { slug: "a", verdict: "pass", durationMs: 100 } },
      { result: { slug: "b", verdict: "fail", reason: "断言不通过", durationMs: 200, checks: [] } },
      { result: { slug: "c", verdict: "need-human", reason: "MFA", durationMs: 0 } },
    ],
  });
  assertMatch(xml, /tests="3"/);
  assertMatch(xml, /failures="1"/);
  assertMatch(xml, /skipped="1"/);
});

// -------------------------------------------------------------------- mocks
test("scripted mock answers in the contract shape", async () => {
  const ask = scriptedAsk([{ op: "click", match: /submit/i }, { op: "done" }]);
  const state = { elements: [{ id: 7, name: "Submit order", actionable: true }], values: {} };
  const first = await ask(state);
  assertEq(first.op.choice, "click");
  assertEq(first.target_click.choice, "7");
  assertEq((await ask(state)).op.choice, "done");
});

test("autoFormAsk terminates instead of refilling for ever", async () => {
  const ask = autoFormAsk();
  const elements = [
    { id: 1, role: "textbox", name: "姓名", actionable: true },
    { id: 2, role: "textbox", name: "邮箱", actionable: true },
    { id: 3, role: "button", name: "提交", actionable: true },
  ];
  const state = { elements, values: { a: { value: "1" }, b: { value: "2" } } };
  const ops = [];
  for (let i = 0; i < 6; i++) ops.push((await ask(state)).op.choice);
  assertEq(ops.join(","), "fill,fill,click,done,done,done");
});
