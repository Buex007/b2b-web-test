// recorder.mjs — the per-case execution record.
//
// A record is a directory, not a database row: everything about one run of one
// case lives under <caseDir>, so it can be zipped, archived, or deleted as a
// unit. `result.json` is the machine-readable summary, `steps.jsonl` the
// append-only timeline, `shots/` the evidence.
//
// Design notes
//   * steps.jsonl is appended as each step closes, so a crash mid-case still
//     leaves a usable timeline.
//   * every path is absolute and arrives from the caller — nothing is derived
//     from process.cwd(), which is "/" inside the ego runtime.
//   * the recorder never decides pass/fail on its own. The agent owns the
//     verdict; the recorder makes it auditable.

import {
  nowIso,
  slugify,
  shortId,
  ensureDir,
  exists,
  writeText,
  writeJson,
  readJson,
  appendLine,
  listDirs,
  fmtMs,
  fs,
  nodePath,
} from "./util.mjs";
import { installCollector, drainCollector } from "./collectors.mjs";
import { renderCase, renderBatch, renderDashboard } from "./report.mjs";

export const VERDICTS = ["pass", "fail", "need-human", "blocked", "error", "running"];

/** Exit codes let a shell or CI branch without parsing JSON. */
export const EXIT_CODE = {
  pass: 0,
  fail: 1,
  error: 1,
  "need-human": 2,
  blocked: 3,
  running: 4,
  unknown: 4,
};

/** Batches get an identifier the caller can quote: time-ordered + tie-breaker. */
export function newBatchId({ label } = {}) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const suffix = label ? `-${slugify(label, { max: 24 })}` : "";
  return `${stamp}-${shortId(4)}${suffix}`;
}

/**
 * Create (or claim) a directory. Returns null when `exclusive` and the name is
 * taken — the caller then picks another name. mkdir is atomic, so two agents
 * starting at the same second cannot collide.
 */
export async function claimDir(dir, { exclusive = false } = {}) {
  const f = await fs();
  if (exclusive) {
    try {
      await f.mkdir(dir, { recursive: false });
      return dir;
    } catch {
      return null;
    }
  }
  await f.mkdir(dir, { recursive: true });
  return dir;
}

const CASE_MD = ({ description, url, env, agent, batchId, caseId }) => `# 用例

## 用例描述（原始输入，未做结构化约束）

${description}

## 入口地址

${url}

## 执行信息

- 批次：\`${batchId}\`
- 用例目录：\`${caseId}\`
- 环境：${env || "-"}
- 执行者：${agent || "-"}
- 创建时间：${nowIso()}

## 说明

本目录是一次执行的完整记录：\`steps.jsonl\` 是逐步时间线，\`shots/\` 是过程截图，
\`result.json\` 是结论，\`report.md\` / \`report.html\` 是给人看的报告。

凭据不写入本目录。
`;

const PLAN_MD = (description) => `# 执行计划（草稿，可随时改）

> 这是执行者开工前写的步骤草稿，不是交付约束。执行中的真实过程以
> \`steps.jsonl\` 为准；结论以 \`result.json\` 为准。

## 目标

${description}

## 步骤（草稿）

1. （待填）

## 判定标准（草稿）

- （待填：什么现象算通过）

## 风险与前置

- （待填：登录/MFA、测试数据、不可逆操作）
`;

const PLAN_MJS = (ctx) => `// plan.mjs — 这次执行的脚本。由 b2b-web-test 准备好，执行者直接改。
//
// 运行： b2b-test exec ${ctx.caseDir}
//
// 可用的东西都在 globalThis.B2B 上：
//   B2B.ctx     用例上下文（入口地址 url、描述 description、目录、批次…）
//   B2B.rec     记录器：step/shot/note/check/jev/finish
//   B2B.session TaskSpace 与 Page（登录态复用）
//   B2B.jev     Jev 决策循环（"点哪里"交给它）
//   B2B.ego     原样透出的 ego-browser 帮手的原始 API 入口
//
// 示例：
//   export default async function run() {
//     const { ctx, rec, session, jev } = globalThis.B2B;
//     const { page } = await session.open();
//     await rec.step("打开入口地址", { op: "goto" });
//     await page.goto(ctx.url, { waitUntil: "domcontentloaded" });
//     const r = await jev.run({
//       goal: "在页面上找到登录按钮并进入登录页",
//       verify: async (p) => /login/.test(await p.url()),
//     });
//     if (r.status !== "done") await rec.bad("未能进入登录页");
//     await rec.finish("pass", "说明为什么算通过");
//   }

export default async function run() {
  const { ctx, rec, session } = globalThis.B2B;
  const { page } = await session.open();
  await rec.step("打开入口地址", { op: "goto" });
  await page.goto(ctx.url, { waitUntil: "domcontentloaded" });
  await rec.note("骨架已就绪，请按用例描述补全执行步骤");
  await rec.finish("running", "未完成：plan.mjs 还是骨架");
}
`;

/**
 * Create the working directory for one case, before anything is executed.
 * Returns the absolute paths so the caller can hand them to the runtime.
 */
export async function createCaseDir({
  batchDir,
  batchId,
  seq,
  slug,
  url,
  description,
  env,
  agent,
  engine,
}) {
  const path = await nodePath();
  // mkdir is used non-recursively to claim a name atomically, so the parent
  // has to exist first.
  await ensureDir(path.join(batchDir, "cases"));
  let caseId = `${String(seq).padStart(2, "0")}-${slug}`;
  let caseDir = path.join(batchDir, "cases", caseId);
  let claimed = await claimDir(caseDir, { exclusive: true });
  let n = seq;
  while (!claimed) {
    n += 1;
    caseId = `${String(n).padStart(2, "0")}-${slug}`;
    caseDir = path.join(batchDir, "cases", caseId);
    claimed = await claimDir(caseDir, { exclusive: true });
    if (n > seq + 200) throw new Error("could not claim a case directory");
  }

  await ensureDir(path.join(caseDir, "shots"));
  await ensureDir(path.join(caseDir, "snapshots"));
  await writeText(path.join(caseDir, "steps.jsonl"), "");

  const meta = { batchId, caseId, slug, url, description, env, agent, engine };
  await writeText(
    path.join(caseDir, "case.md"),
    CASE_MD(meta),
  );
  await writeText(path.join(caseDir, "plan.md"), PLAN_MD(description));
  const ctxStub = { caseDir };
  const planPath = path.join(caseDir, "plan.mjs");
  if (!(await exists(planPath))) {
    await writeText(planPath, PLAN_MJS(ctxStub));
  }
  await writeJson(path.join(caseDir, "result.json"), {
    batchId,
    caseId,
    slug,
    url,
    description,
    env: env || null,
    agent: agent || null,
    engine: engine || null,
    startedAt: nowIso(),
    finishedAt: null,
    durationMs: null,
    verdict: "running",
    reason: null,
    steps: 0,
    checks: [],
    shots: [],
    errors: [],
    network: [],
    jev: { calls: 0, tokens: { input: 0, output: 0 }, statuses: {} },
  });

  return { caseDir, caseId, planPath };
}

/**
 * The recorder handed to the executing agent.
 */
export function createRecorder({
  dataDir,
  batchDir,
  caseDir,
  caseId,
  slug,
  batchId,
  url,
  description,
  env,
  agent,
  engine,
  options = {},
}) {
  const shotsMode = options.shots || "step"; // step | fail | off
  const state = {
    page: null,
    step: null,
    stepNo: 0,
    lastUrl: null,
    checks: [],
    errors: [],
    network: [],
    shots: [],
    jev: { calls: 0, tokens: { input: 0, output: 0 }, statuses: {}, models: new Set() },
    verdict: null,
    reason: null,
    startedAt: Date.now(),
    finished: false,
    shotSeq: 0,
  };

  const path = async () => await nodePath();

  async function appendStep(record) {
    const p = await path();
    await appendLine(p.join(caseDir, "steps.jsonl"), record);
  }

  async function currentUrl() {
    try {
      return state.page ? await state.page.url() : null;
    } catch {
      return null;
    }
  }

  async function captureShot(label) {
    if (!state.page) return null;
    const p = await path();
    state.shotSeq += 1;
    const name = `${String(state.stepNo || state.shotSeq).padStart(2, "0")}-${slugify(
      label || `shot-${state.shotSeq}`,
      { max: 32, fallback: "shot" },
    )}.png`;
    const abs = p.join(caseDir, "shots", name);
    try {
      await state.page.screenshot({ path: abs });
    } catch {
      return null;
    }
    const rel = `shots/${name}`;
    if (!state.shots.includes(rel)) state.shots.push(rel);
    return rel;
  }

  async function syncCollector(force = false) {
    if (!state.page) return;
    await installCollector(state.page);
    const drained = await drainCollector(state.page);
    for (const e of drained?.errors || []) state.errors.push(e);
    for (const n of drained?.net || []) state.network.push(n);
    void force;
  }

  function mergeJev(result) {
    const t = result?.timings || {};
    const tokens = t.tokens || {};
    state.jev.calls += t.llmCalls?.length || 0;
    state.jev.tokens.input += tokens.input || 0;
    state.jev.tokens.output += tokens.output || 0;
    if (t.model) for (const part of String(t.model).split(",")) state.jev.models.add(part.trim());
    const st = result?.status || "unknown";
    state.jev.statuses[st] = (state.jev.statuses[st] || 0) + 1;
    return {
      status: st,
      reason: result?.reason || null,
      steps: result?.steps ?? null,
      calls: t.llmCalls?.length || 0,
      model: t.model || null,
      trace: result?.trace || null,
    };
  }

  const rec = {
    get caseDir() {
      return caseDir;
    },
    get batchDir() {
      return batchDir;
    },
    get dataDir() {
      return dataDir;
    },
    get batchId() {
      return batchId;
    },
    get caseId() {
      return caseId;
    },
    get state() {
      return state;
    },

    /** Register the Page used for screenshots and evidence capture. */
    async attach(page) {
      state.page = page;
      state.lastUrl = await currentUrl();
      await syncCollector();
      return page;
    },

    /** Close the current step and open a new one. */
    async step(label, meta = {}) {
      if (state.step) await rec.endStep(meta.status);
      if (state.page) await syncCollector();
      state.stepNo += 1;
      state.step = {
        step: state.stepNo,
        label: String(label ?? `step ${state.stepNo}`),
        op: meta.op || null,
        target: meta.target || null,
        status: "ok",
        detail: meta.detail || null,
        ts: nowIso(),
        _t0: Date.now(),
        shot: null,
        jev: null,
      };
      // Re-inject the collector whenever the document changed (navigation
      // wipes everything the previous document held).
      const nowUrl = await currentUrl();
      if (nowUrl !== state.lastUrl) {
        state.lastUrl = nowUrl;
        await installCollector(state.page).catch(() => {});
      }
      return state.step;
    },

    /** Mark the open step as failed (or passing) without closing it. */
    bad(detail) {
      if (state.step) {
        state.step.status = "fail";
        state.step.detail = detail ? String(detail) : state.step.detail;
      }
      return detail;
    },
    warn(detail) {
      if (state.step && state.step.status === "ok") {
        state.step.status = "warn";
        state.step.detail = detail ? String(detail) : state.step.detail;
      }
      return detail;
    },
    note(text) {
      if (state.step) {
        state.step.detail = state.step.detail
          ? `${state.step.detail} · ${String(text)}`
          : String(text);
      }
      return text;
    },

    /** Explicit screenshot; also usable outside a step. */
    shot(label) {
      return captureShot(label || state.step?.label || "shot");
    },

    /** Record one判定. `ok` is the agent's judgment; the detail explains it. */
    async check(label, ok, detail) {
      const item = { label: String(label), ok: Boolean(ok), detail: detail ? String(detail) : null };
      state.checks.push(item);
      if (state.step) {
        if (!ok) {
          state.step.status = "fail";
          if (item.detail) state.step.detail = item.detail;
        }
        if (!state.step.checks) state.step.checks = [];
        state.step.checks.push(item);
      }
      return item;
    },

    /** Attach a Jev loop result to the open step (or stand alone). */
    async jev(result) {
      const summary = mergeJev(result);
      if (!state.step) await rec.step("（Jev 决策）", { op: "jev" });
      state.step.jev = summary;
      return summary;
    },

    /** The run handed control to a human (login, MFA, captcha…). */
    async handoff(reason) {
      if (state.step) state.step.detail = `人工接管：${reason}`;
      state.checks.push({ label: "人工接管", ok: true, detail: String(reason) });
      return reason;
    },

    error(err) {
      const message = err?.stack || err?.message || String(err);
      state.errors.push({ t: Date.now(), kind: "runner", message });
      if (!state.step) {
        // keep it visible in the timeline too
        state.stepNo += 1;
        state.step = {
          step: state.stepNo,
          label: "执行异常",
          status: "fail",
          detail: message.split("\n")[0],
          ts: nowIso(),
          _t0: Date.now(),
          shot: null,
          jev: null,
        };
      } else {
        state.step.status = "fail";
      }
      return message;
    },

    /** Close the open step, collecting its evidence. */
    async endStep(status) {
      const s = state.step;
      if (!s) return null;
      if (status && s.status === "ok") s.status = status;
      s.durationMs = Date.now() - s._t0;
      s.url = await currentUrl();
      await syncCollector();
      const wantShot =
        shotsMode === "step" || (shotsMode === "fail" && s.status !== "ok") || Boolean(s.shot);
      if (wantShot && !s.shot) s.shot = await captureShot(s.label);
      delete s._t0;
      await appendStep(s);
      state.step = null;
      return s;
    },

    /** Write result.json, refresh batch + dashboard, render the reports. */
    async finish(verdict, reason) {
      if (state.finished) return { verdict: state.verdict, alreadyFinished: true };
      state.verdict = VERDICTS.includes(verdict) ? verdict : verdict ? "fail" : "unknown";
      state.reason = reason ? String(reason) : null;
      if (state.step) await rec.endStep();
      await syncCollector();

      const p = await path();
      const resultPath = p.join(caseDir, "result.json");
      const prev = (await readJson(resultPath, {})) || {};
      const finishedAt = nowIso();
      const result = {
        ...prev,
        batchId,
        caseId,
        slug,
        url,
        description,
        env: env || null,
        agent: agent || null,
        engine: engine || null,
        startedAt: prev.startedAt || new Date(state.startedAt).toISOString(),
        finishedAt,
        durationMs: Date.now() - state.startedAt,
        verdict: state.verdict,
        reason: state.reason,
        steps: state.stepNo,
        checks: state.checks,
        shots: state.shots,
        errors: state.errors,
        network: state.network,
        jev: {
          calls: state.jev.calls,
          tokens: state.jev.tokens,
          statuses: state.jev.statuses,
          model: [...state.jev.models].join(", ") || null,
        },
        artifacts: {
          caseDir,
          steps: "steps.jsonl",
          shots: "shots",
          report: "report.md",
        },
      };
      await writeJson(resultPath, result);
      state.finished = true;

      // Batch roll-up. Sequential runs, so a read/modify/write is safe here.
      try {
        const batchPath = p.join(batchDir, "batch.json");
        const batch = (await readJson(batchPath, {})) || {};
        const caseDirs = await listDirs(p.join(batchDir, "cases"));
        const caseEntries = await Promise.all(
          caseDirs.map(async (dir) => ({
            dir,
            result: await readJson(p.join(dir, "result.json"), null),
          })),
        );
        const cases = caseEntries.map((c) => c.result || {});
        const summary = { total: cases.length };
        for (const v of ["pass", "fail", "need-human", "blocked", "error", "running"]) {
          summary[v] = cases.filter((c) => c.verdict === v).length;
        }
        batch.summary = summary;
        batch.finishedAt = finishedAt;
        batch.cost = {
          llmCalls: cases.reduce((a, c) => a + (c.jev?.calls || 0), 0),
          tokensIn: cases.reduce((a, c) => a + (c.jev?.tokens?.input || 0), 0),
          tokensOut: cases.reduce((a, c) => a + (c.jev?.tokens?.output || 0), 0),
        };
        await writeJson(batchPath, batch);
        await renderBatch({ batchDir, batch, cases: caseEntries });
      } catch {
        // A batch roll-up failure must never invalidate the case record.
      }

      try {
        await renderCase({ caseDir, result });
        await renderDashboard({ dataDir });
      } catch {
        /* reports are a convenience; the raw record above is the contract */
      }

      return { verdict: result.verdict, reason: result.reason, durationMs: result.durationMs, resultPath };
    },

    /** Compact view for the launcher's stdout. */
    summary() {
      return {
        batchId,
        caseId,
        caseDir,
        verdict: state.verdict,
        steps: state.stepNo,
        checks: state.checks.length,
        shots: state.shots.length,
        errors: state.errors.length,
        network: state.network.length,
        jev: { calls: state.jev.calls, tokens: state.jev.tokens },
      };
    },
  };

  return rec;
}

export const __internal = { CASE_MD, PLAN_MD, PLAN_MJS };
