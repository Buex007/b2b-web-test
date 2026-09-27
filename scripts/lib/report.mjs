// report.mjs — turns a case directory into a human-readable record.
//
// Two artefacts per case, plus one dashboard for everything:
//   <case>/report.md    plain text: readable by any agent, greppable, diffs well
//   <case>/report.html  single file, no CDN, opens offline: timeline + shots
//   <dataDir>/reports/index.html  every batch, every case, and per-case history
//
// The HTML deliberately inlines all CSS/JS and references screenshots by
// relative path, so the record can be zipped, archived, or opened on a machine
// with no network.

import {
  listDirs,
  readJson,
  readJsonl,
  writeText,
  writeJson,
  htmlEscape as esc,
  fmtMs,
  nodePath,
} from "./util.mjs";

const VERDICT_LABEL = {
  pass: "通过",
  fail: "失败",
  "need-human": "待人工",
  blocked: "受阻",
  error: "异常",
  running: "进行中",
  unknown: "未判定",
};

const VERDICT_CLASS = {
  pass: "ok",
  fail: "bad",
  "need-human": "warn",
  blocked: "warn",
  error: "bad",
  running: "info",
  unknown: "muted",
};

function verdictBadge(v) {
  const k = VERDICT_CLASS[v] || "muted";
  return `<span class="badge ${k}">${esc(VERDICT_LABEL[v] || v || "未判定")}</span>`;
}

const STYLE = `
:root{--bg:#0f1115;--card:#171a21;--line:#252a34;--fg:#e6e9ef;--dim:#98a2b3;
--ok:#3fb950;--bad:#f85149;--warn:#d29922;--info:#58a6ff;--muted:#6e7681}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:16px;margin:28px 0 10px}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
.kv{display:grid;grid-template-columns:120px 1fr;gap:4px 12px;font-size:13px}
.kv dt{color:var(--dim)}
.kv dd{margin:0;word-break:break-all}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;
border:1px solid transparent}
.badge.ok{color:var(--ok);border-color:#1d3a22;background:#102415}
.badge.bad{color:var(--bad);border-color:#4b1f1d;background:#2a1211}
.badge.warn{color:var(--warn);border-color:#453714;background:#251d0c}
.badge.info{color:var(--info);border-color:#17304f;background:#0e1c2c}
.badge.muted{color:var(--muted);border-color:#2b303b;background:#1a1d24}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:500}
tr:last-child td{border-bottom:none}
.stats{display:flex;gap:20px;flex-wrap:wrap}
.stat{min-width:96px}
.stat b{display:block;font-size:22px;line-height:1.2}
.stat span{color:var(--dim);font-size:12px}
.tl{list-style:none;margin:0;padding:0}
.tl li{display:grid;grid-template-columns:52px 1fr 220px;gap:14px;
padding:12px 0;border-bottom:1px solid var(--line)}
.tl li:last-child{border-bottom:none}
.tl .n{color:var(--dim);font-variant-numeric:tabular-nums}
.tl .lbl{font-weight:500}
.tl .meta{color:var(--dim);font-size:12px;margin-top:2px}
.tl .shot{text-align:right}
.tl .shot img{max-width:200px;max-height:130px;border-radius:6px;border:1px solid var(--line);
display:block;margin-left:auto;background:#000}
.tl .shot a{display:block}
.tl .noimg{color:var(--muted);font-size:12px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
pre{background:#0b0d11;border:1px solid var(--line);border-radius:8px;padding:10px;
overflow:auto;max-height:260px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.grid a{display:block;background:#0b0d11;border:1px solid var(--line);border-radius:8px;
padding:10px}
.grid a:hover{border-color:#3b4252}
.dim{color:var(--dim)}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;display:flex}
.bar i{display:block;height:100%}
`;

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><div class="wrap">${body}</div></body></html>
`;
}

function durationOf(result) {
  if (!result) return null;
  if (result.durationMs != null) return result.durationMs;
  if (result.startedAt && result.finishedAt) {
    return new Date(result.finishedAt) - new Date(result.startedAt);
  }
  return null;
}

/** Per-case record: report.md + report.html. */
export async function renderCase({ caseDir, result }) {
  const path = await nodePath();
  const steps = await readJsonl(path.join(caseDir, "steps.jsonl"));

  const lines = [];
  lines.push(`# 用例记录：${result.slug || result.caseId}`);
  lines.push("");
  lines.push(
    `- 结论：**${VERDICT_LABEL[result.verdict] || result.verdict}**${
      result.reason ? ` — ${result.reason}` : ""
    }`,
  );
  lines.push(`- 批次：\`${result.batchId}\``);
  lines.push(`- 入口地址：${result.url || "-"}`);
  lines.push(`- 用例描述：${result.description || "-"}`);
  lines.push(`- 环境：${result.env || "-"} · 执行者：${result.agent || "-"}`);
  lines.push(
    `- 开始：${result.startedAt || "-"} · 结束：${result.finishedAt || "-"} · 耗时：${fmtMs(
      durationOf(result),
    )}`,
  );
  lines.push(`- 步骤：${steps.length} · 截图：${(result.shots || []).length}`);
  if (result.jev?.calls) {
    const tk = result.jev.tokens || {};
    lines.push(
      `- Jev：${result.jev.calls} 次调用 · 输入 ${tk.input || 0} / 输出 ${
        tk.output || 0
      } tokens · 模型 ${result.jev.model || "-"}`,
    );
  }
  lines.push("");
  if (result.checks?.length) {
    lines.push("## 判定");
    lines.push("");
    for (const c of result.checks) {
      lines.push(`- ${c.ok ? "✅" : "❌"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## 执行过程");
  lines.push("");
  for (const s of steps) {
    const mark = s.status === "fail" ? "❌" : s.status === "warn" ? "⚠️" : "✅";
    const bits = [];
    if (s.op) bits.push(`\`${s.op}\``);
    if (s.url) bits.push(s.url);
    if (s.durationMs != null) bits.push(fmtMs(s.durationMs));
    lines.push(
      `${String(s.step).padStart(2, "0")}. ${mark} **${s.label}** ${
        bits.length ? `— ${bits.join(" · ")}` : ""
      }`,
    );
    if (s.detail) lines.push(`    ${s.detail}`);
    if (s.jev) {
      lines.push(
        `    ↳ Jev: ${s.jev.status}${s.jev.steps ? ` / ${s.jev.steps} 步` : ""}${
          s.jev.reason ? ` / ${s.jev.reason}` : ""
        }`,
      );
    }
    if (s.shot) lines.push(`    📷 ${s.shot}`);
  }
  if (result.errors?.length) {
    lines.push("");
    lines.push("## 页面错误");
    lines.push("");
    for (const e of result.errors.slice(0, 50)) lines.push(`- [${e.kind}] ${e.message}`);
  }
  if (result.network?.length) {
    lines.push("");
    lines.push("## 异常请求（4xx/5xx）");
    lines.push("");
    for (const n of result.network.slice(0, 50)) {
      lines.push(`- ${n.status} ${n.method || n.via || ""} ${n.url}`);
    }
  }
  lines.push("");
  await writeText(path.join(caseDir, "report.md"), lines.join("\n"));

  const stepRows = steps
    .map((s) => {
      const shot = s.shot
        ? `<a href="${esc(s.shot)}" target="_blank"><img src="${esc(
            s.shot,
          )}" loading="lazy" alt="step ${s.step}"></a>`
        : `<span class="noimg">—</span>`;
      const meta = [
        s.url ? `<span class="mono">${esc(s.url)}</span>` : "",
        s.durationMs != null ? fmtMs(s.durationMs) : "",
        s.op ? `<span class="mono">${esc(s.op)}</span>` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const jev = s.jev
        ? `<div class="meta">Jev: ${esc(s.jev.status)}${
            s.jev.reason ? ` / ${esc(s.jev.reason)}` : ""
          }${s.jev.calls ? ` / ${s.jev.calls} 次调用` : ""}</div>`
        : "";
      const mark = s.status === "fail" ? "❌" : s.status === "warn" ? "⚠️" : "✅";
      return `<li>
  <div class="n">${String(s.step).padStart(2, "0")} ${mark}</div>
  <div>
    <div class="lbl">${esc(s.label)}</div>
    ${s.detail ? `<div class="meta">${esc(s.detail)}</div>` : ""}
    ${meta ? `<div class="meta">${meta}</div>` : ""}
    ${jev}
  </div>
  <div class="shot">${shot}</div>
</li>`;
    })
    .join("");

  const batchLink = `../batch.html`;
  const body = `
<h1>${esc(result.slug || result.caseId)} ${verdictBadge(result.verdict)}</h1>
<div class="sub"><a href="${batchLink}">← 批次 ${esc(result.batchId)}</a> ·
<a href="../../../../reports/index.html">全部记录</a></div>

<div class="card">
  <dl class="kv">
    <dt>用例描述</dt><dd>${esc(result.description || "-")}</dd>
    <dt>入口地址</dt><dd class="mono">${esc(result.url || "-")}</dd>
    <dt>结论说明</dt><dd>${esc(result.reason || "-")}</dd>
    <dt>批次 / 用例</dt><dd class="mono">${esc(result.batchId)} · ${esc(result.caseId)}</dd>
    <dt>环境 / 执行者</dt><dd>${esc(result.env || "-")} · ${esc(result.agent || "-")}</dd>
    <dt>起止 / 耗时</dt><dd>${esc(result.startedAt || "-")} → ${esc(
      result.finishedAt || "-",
    )} · ${fmtMs(durationOf(result))}</dd>
    <dt>引擎</dt><dd class="mono">${esc(result.engine?.ego || "-")} · ${esc(
      result.engine?.jev || "-",
    )}</dd>
  </dl>
</div>

${
  result.checks?.length
    ? `<h2>判定</h2><div class="card"><table><tr><th>检查项</th><th>结果</th><th>说明</th></tr>${result.checks
        .map(
          (c) =>
            `<tr><td>${esc(c.label)}</td><td>${c.ok ? "✅" : "❌"}</td><td>${esc(
              c.detail || "",
            )}</td></tr>`,
        )
        .join("")}</table></div>`
    : ""
}

<h2>执行过程（${steps.length} 步）</h2>
<div class="card"><ul class="tl">${stepRows || '<li class="dim">没有步骤记录</li>'}</ul></div>

${
  result.errors?.length
    ? `<h2>页面错误（${result.errors.length}）</h2><div class="card"><pre>${esc(
        result.errors
          .slice(0, 40)
          .map((e) => `[${e.kind}] ${e.message}`)
          .join("\n"),
      )}</pre></div>`
    : ""
}
${
  result.network?.length
    ? `<h2>异常请求（${result.network.length}）</h2><div class="card"><pre>${esc(
        result.network
          .slice(0, 40)
          .map((n) => `${n.status} ${n.method || n.via || ""} ${n.url}`)
          .join("\n"),
      )}</pre></div>`
    : ""
}
`;
  await writeText(path.join(caseDir, "report.html"), page(`用例记录 ${result.slug}`, body));
  return { md: path.join(caseDir, "report.md"), html: path.join(caseDir, "report.html") };
}

function summarize(cases) {
  const s = {
    total: cases.length,
    pass: 0,
    fail: 0,
    needHuman: 0,
    blocked: 0,
    error: 0,
    running: 0,
    durationMs: 0,
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  for (const c of cases) {
    const r = c.result || {};
    const v = r.verdict || "unknown";
    if (v === "pass") s.pass++;
    else if (v === "fail" || v === "error") s.fail++;
    else if (v === "need-human") s.needHuman++;
    else if (v === "blocked") s.blocked++;
    else if (v === "running") s.running++;
    s.durationMs += durationOf(r) || 0;
    s.llmCalls += r.jev?.calls || 0;
    s.tokensIn += r.jev?.tokens?.input || 0;
    s.tokensOut += r.jev?.tokens?.output || 0;
  }
  return s;
}

function statBlock(s) {
  return `<div class="stats">
  <div class="stat"><b>${s.total}</b><span>用例</span></div>
  <div class="stat"><b style="color:var(--ok)">${s.pass}</b><span>通过</span></div>
  <div class="stat"><b style="color:var(--bad)">${s.fail}</b><span>失败/异常</span></div>
  <div class="stat"><b style="color:var(--warn)">${s.needHuman + s.blocked}</b><span>待人工/受阻</span></div>
  <div class="stat"><b>${fmtMs(s.durationMs)}</b><span>总耗时</span></div>
  <div class="stat"><b>${s.llmCalls}</b><span>Jev 调用</span></div>
  <div class="stat"><b>${(
    (s.tokensIn + s.tokensOut) / 1000
  ).toFixed(1)}K</b><span>tokens</span></div>
</div>`;
}

/** Batch-level record: batch.md + batch.html. */
export async function renderBatch({ batchDir, batch, cases }) {
  const path = await nodePath();
  const s = summarize(cases);
  const rows = cases
    .map(
      (c) => `<tr>
  <td><a href="cases/${esc(path.basename(c.dir))}/report.html">${esc(
    c.result?.slug || path.basename(c.dir),
  )}</a></td>
  <td>${verdictBadge(c.result?.verdict)}</td>
  <td>${esc(c.result?.reason || "")}</td>
  <td>${fmtMs(durationOf(c.result))}</td>
  <td>${c.result?.steps ?? ""}</td>
</tr>`,
    )
    .join("");

  const md = [];
  md.push(`# 批次 ${batch.batchId}`);
  md.push("");
  md.push(`- 标签：${batch.label || "未标注"}`);
  md.push(`- 环境：${batch.env || "-"} · 执行者：${batch.agent || "-"}`);
  md.push(`- 开始：${batch.startedAt || "-"}`);
  md.push(
    `- 汇总：共 ${s.total} · 通过 ${s.pass} · 失败 ${s.fail} · 待人工 ${
      s.needHuman
    } · 受阻 ${s.blocked} · 进行中 ${s.running}`,
  );
  md.push("");
  md.push("| 用例 | 结论 | 说明 | 耗时 | 步骤 |");
  md.push("|---|---|---|---|---|");
  for (const c of cases) {
    md.push(
      `| ${c.result?.slug || path.basename(c.dir)} | ${
        VERDICT_LABEL[c.result?.verdict] || c.result?.verdict || "-"
      } | ${c.result?.reason || ""} | ${fmtMs(durationOf(c.result))} | ${
        c.result?.steps ?? ""
      } |`,
    );
  }
  await writeText(path.join(batchDir, "batch.md"), md.join("\n"));

  const body = `
<h1>批次 ${esc(batch.batchId)}</h1>
<div class="sub">${esc(batch.label || "未标注")} ·
<a href="../../../reports/index.html">全部记录</a></div>
<div class="card">${statBlock(s)}</div>
<div class="card">
  <dl class="kv">
    <dt>环境</dt><dd>${esc(batch.env || "-")}</dd>
    <dt>执行者</dt><dd>${esc(batch.agent || "-")}</dd>
    <dt>引擎</dt><dd class="mono">${esc(batch.engine?.ego || "-")} · ${esc(
      batch.engine?.jev || "-",
    )}</dd>
    <dt>开始时间</dt><dd>${esc(batch.startedAt || "-")}</dd>
  </dl>
</div>
<h2>用例</h2>
<div class="card"><table>
<tr><th>用例</th><th>结论</th><th>说明</th><th>耗时</th><th>步骤</th></tr>
${rows || '<tr><td colspan="5" class="dim">还没有用例</td></tr>'}
</table></div>`;
  await writeText(path.join(batchDir, "batch.html"), page(`批次 ${batch.batchId}`, body));
  return { md: path.join(batchDir, "batch.md") };
}

/** Scan the data directory. The filesystem is the source of truth — there is
 * no separate index to drift out of sync. */
export async function scanAll({ dataDir }) {
  const path = await nodePath();
  const batchesRoot = path.join(dataDir, "batches");
  const batches = [];
  for (const bDir of await listDirs(batchesRoot)) {
    const batch = await readJson(path.join(bDir, "batch.json"), {});
    const cases = [];
    for (const cDir of await listDirs(path.join(bDir, "cases"))) {
      const result = await readJson(path.join(cDir, "result.json"), null);
      cases.push({ dir: cDir, result });
    }
    batches.push({ dir: bDir, id: batch.batchId || path.basename(bDir), batch, cases });
  }
  // Prefer the recorded start time; fall back to the id, which is itself a
  // chronological key (YYYYMMDD-HHMMSS-xxxx).
  batches.sort((a, b) => {
    const ka = a.batch.startedAt || a.id;
    const kb = b.batch.startedAt || b.id;
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  return batches;
}

/** Global dashboard: every batch + per-case history across batches. */
export async function renderDashboard({ dataDir, writeIndexJson = true }) {
  const path = await nodePath();
  const batches = await scanAll({ dataDir });
  const allCases = batches.flatMap((b) => b.cases.map((c) => ({ ...c, batch: b })));
  const s = summarize(allCases);

  // Per-case history: same slug across batches -> is this test getting better?
  const byCase = new Map();
  for (const c of allCases) {
    const key = c.result?.slug || path.basename(c.dir);
    if (!byCase.has(key)) byCase.set(key, []);
    byCase.get(key).push(c);
  }
  const historyRows = [...byCase.entries()]
    .sort()
    .map(([slug, list]) => {
      const recent = list
        .slice()
        .sort((a, b) => (a.batch.id < b.batch.id ? 1 : -1))
        .slice(0, 12)
        .reverse();
      const strip = recent
        .map(
          (c) =>
            `<span class="badge ${
              VERDICT_CLASS[c.result?.verdict] || "muted"
            }" title="${esc(c.batch.id)}">${
              VERDICT_LABEL[c.result?.verdict] || "?"
            }</span>`,
        )
        .join(" ");
      const last = list[list.length - 1];
      return `<tr>
  <td>${esc(slug)}</td>
  <td>${strip}</td>
  <td>${list.length}</td>
  <td class="mono dim">${esc(last?.result?.url || "-")}</td>
</tr>`;
    })
    .join("");

  const batchRows = batches
    .map((b) => {
      const bs = summarize(b.cases);
      const link = `../batches/${esc(b.id)}/batch.html`;
      const badge = bs.fail
        ? "fail"
        : bs.running
          ? "running"
          : bs.needHuman + bs.blocked
            ? "need-human"
            : bs.total
              ? "pass"
              : "running";
      return `<tr>
  <td><a href="${link}">${esc(b.id)}</a></td>
  <td>${esc(b.batch.label || "")}</td>
  <td>${verdictBadge(badge)}</td>
  <td>${bs.total}</td>
  <td>${bs.pass} / ${bs.fail} / ${bs.needHuman + bs.blocked}${bs.running ? ` / ${bs.running} 未完成` : ""}</td>
  <td>${fmtMs(bs.durationMs)}</td>
  <td class="dim">${esc((b.batch.startedAt || "").slice(0, 19).replace("T", " "))}</td>
</tr>`;
    })
    .join("");

  const body = `
<h1>B 端 Web 测试记录</h1>
<div class="sub">数据目录 <span class="mono">${esc(dataDir)}</span> ·
生成于 ${esc(new Date().toISOString().slice(0, 19).replace("T", " "))}</div>
<div class="card">${statBlock(s)}</div>

<h2>批次（${batches.length}）</h2>
<div class="card"><table>
<tr><th>批次</th><th>标签</th><th>结果</th><th>用例</th><th>通过/失败/待人工</th><th>耗时</th><th>时间</th></tr>
${batchRows || '<tr><td colspan="7" class="dim">还没有记录</td></tr>'}
</table></div>

<h2>按用例看历史</h2>
<div class="card"><table>
<tr><th>用例</th><th>最近若干次</th><th>执行次数</th><th>入口地址</th></tr>
${historyRows || '<tr><td colspan="4" class="dim">还没有记录</td></tr>'}
</table></div>

<p class="dim">说明：结论由执行者判定；每一步的截图、页面错误与异常请求都保存在对应用例目录里，
点进批次或用例即可回溯。</p>
`;

  const reportsDir = path.join(dataDir, "reports");
  const htmlPath = path.join(reportsDir, "index.html");
  await writeText(htmlPath, page("B端 Web 测试记录", body));
  if (writeIndexJson) {
    await writeJson(path.join(reportsDir, "index.json"), {
      generatedAt: new Date().toISOString(),
      dataDir,
      summary: s,
      batches: batches.map((b) => ({
        batchId: b.id,
        label: b.batch.label || null,
        startedAt: b.batch.startedAt || null,
        cases: b.cases.map((c) => ({
          caseId: c.result?.caseId || path.basename(c.dir),
          slug: c.result?.slug || path.basename(c.dir),
          verdict: c.result?.verdict || "unknown",
          durationMs: durationOf(c.result),
          steps: c.result?.steps ?? null,
        })),
      })),
    });
  }
  return { html: htmlPath, batches: batches.length, cases: allCases.length, summary: s };
}

/** JUnit XML for CI consumption. */
export async function toJUnit({ cases, suiteName = "b2b-web-test" }) {
  const esc2 = (x) =>
    String(x ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const failures = cases.filter((c) => ["fail", "error"].includes(c.result?.verdict)).length;
  const skipped = cases.filter((c) =>
    ["need-human", "blocked", "running"].includes(c.result?.verdict),
  ).length;
  const time = (cases.reduce((a, c) => a + (durationOf(c.result) || 0), 0) / 1000).toFixed(3);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuite name="${esc2(suiteName)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" time="${time}">`,
  ];
  for (const c of cases) {
    const r = c.result || {};
    const name = esc2(r.slug || "case");
    const t = ((durationOf(r) || 0) / 1000).toFixed(3);
    lines.push(`  <testcase classname="${esc2(suiteName)}" name="${name}" time="${t}">`);
    if (["fail", "error"].includes(r.verdict)) {
      lines.push(
        `    <failure message="${esc2(r.reason || r.verdict)}">${esc2(
          (r.checks || [])
            .filter((x) => !x.ok)
            .map((x) => `${x.label}: ${x.detail || ""}`)
            .join("\n") || r.reason || "",
        )}</failure>`,
      );
    } else if (["need-human", "blocked", "running"].includes(r.verdict)) {
      lines.push(`    <skipped message="${esc2(r.reason || r.verdict)}"/>`);
    }
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>");
  return lines.join("\n");
}
