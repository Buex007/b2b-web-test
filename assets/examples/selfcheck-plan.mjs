// 离线自检计划（b2b-test selfcheck 会把它复制到用例目录里执行）
//
// 目的：用本机 file:// 页面 + 内置 mock 决策器，把整条链路跑一遍——
// 工作目录、步骤记录、过程截图、结论、报告、看板。
// 不联网、不需要密钥、不花 token。

export default async function run() {
  const { ctx, rec, session, jev, ego } = globalThis.B2B;

  await rec.step("打开自检页面", { op: "goto" });
  const { page } = await session.open();
  await page.goto(ctx.url, { waitUntil: "domcontentloaded" });
  await rec.note("本机 file:// 页面，全程不联网");

  await rec.step("用 Jev 填写表单并提交", { op: "jev" });
  const loop = await jev.run({
    goal: "填写姓名和邮箱，然后点击提交按钮",
    values: { custname: "B2B Selfcheck", custemail: "selfcheck@example.com" },
    maxSteps: 8,
  });
  await rec.check(
    "Jev 决策循环走到结束",
    loop.status === "done",
    `status=${loop.status}${loop.reason ? ` / ${loop.reason}` : ""} / ${loop.steps ?? "?"} 步`,
  );

  await rec.step("确认提交结果", { op: "verify" });
  const sawSuccess = await ego.waitForText(page, "提交成功", { timeout: 8000 });
  if (!sawSuccess) await rec.bad("页面上没有出现「提交成功」");
  await rec.check(
    "提交后出现成功提示",
    sawSuccess,
    sawSuccess ? "页面出现「提交成功」" : "未出现成功提示",
  );

  const name = await ego.valueOf(page, 'input[name="custname"]').catch(() => null);
  const fieldOk = Boolean(name && String(name).length);
  await rec.check("姓名字段已写入", fieldOk, fieldOk ? "字段非空" : "字段为空");

  await rec.finish(
    sawSuccess && fieldOk && loop.status === "done" ? "pass" : "fail",
    sawSuccess
      ? "离线自检通过：工作目录、步骤记录、截图、报告链路均正常"
      : "离线自检失败：表单没有被正确填写或提交",
  );
}
