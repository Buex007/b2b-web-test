// 示例：一条典型的 B 端用例计划。
//
// 场景：登录态下的后台，筛选订单 → 核对结果 → 与接口对账。
// 把它当模板：改 goal / values / 判定，就是一条新用例。
//
// 运行： b2b-test exec "<用例目录>"

export default async function run() {
  const { ctx, rec, session, jev, ego } = globalThis.B2B;

  // ---------------------------------------------------------------- 打开入口
  await rec.step("打开入口地址", { op: "goto" });
  const { page } = await session.open();
  await page.goto(ctx.url, { waitUntil: "domcontentloaded" });
  await rec.note(session.reused ? "复用了已有会话" : "新建了会话");

  // ------------------------------------------------------------ 登录态检查
  // 登录/MFA 不自动化：交给人工，然后用 need-human 收尾，等下次重跑复用登录态。
  if (/login|sso|signin/i.test(await page.url())) {
    await rec.handoff("落在登录页，需要人工登录或短信验证");
    await session.handoff("登录页");
    await rec.finish("need-human", "请人工登录后重跑，登录态会被复用");
    return;
  }

  // ---------------------------------------------------------------- 交给 Jev
  await rec.step("筛选出待审核订单", { op: "jev" });
  const loop = await jev.run({
    goal: "把状态筛选为「待审核」，并确认列表已经按该条件刷新",
    values: { status: { value: "待审核", hint: "状态筛选" } },
    // verify 是这个用例真正关心的那件事，而不是"点了某个按钮"
    verify: async (p) =>
      await p.evaluate(() => document.body.innerText.includes("待审核")),
    maxSteps: 12,
  });
  await rec.check(
    "Jev 决策循环完成",
    loop.status === "done",
    `status=${loop.status}${loop.reason ? ` / ${loop.reason}` : ""}`,
  );
  console.log(jev.formatTimings(loop));

  // ------------------------------------------------------------ 自己读结果
  await rec.step("核对筛选结果", { op: "verify" });
  const rows = await ego.tableRows(page, "table");
  const dataRows = (rows || []).slice(1);
  const allPending = dataRows.length > 0 && dataRows.every((r) => r.join(" ").includes("待审核"));
  if (!allPending) await rec.bad("列表里出现了非「待审核」的数据");
  await rec.check("结果全部是待审核", allPending, `共 ${dataRows.length} 行`);

  // ------------------------------------------------ 页面与接口对账（可选）
  await rec.step("页面与接口条数对账", { op: "verify" });
  const uiCount = await ego.countOf(page, "table tbody tr");
  const api = await ego.apiJson(page, "/api/orders?page=1&size=20");
  const apiCount = Array.isArray(api.json?.data) ? api.json.data.length : null;
  const consistent = apiCount == null ? null : uiCount === apiCount;
  await rec.check(
    "页面条数与接口一致",
    consistent !== false, // 拿不到接口数据时不判失败，但记录里能看到
    consistent == null ? `接口未返回可解析数据（status=${api.status}）` : `页面 ${uiCount} / 接口 ${apiCount}`,
  );

  // ------------------------------------------------------------------ 收尾
  const passed = allPending;
  await rec.finish(
    passed ? "pass" : "fail",
    passed ? "筛选与页面结果均符合预期" : "筛选结果与预期不符，详见判定与截图",
  );
}
