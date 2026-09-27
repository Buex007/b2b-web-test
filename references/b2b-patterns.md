# B 端常见场景的写法

下面都是可以直接抄进 `plan.mjs` 的骨架。前提一样：先 `session.open()` 拿 page，
每个动作前用 `rec.step()` 记账，最后 `rec.finish()` 给结论。

## 1. 登录 / SSO / MFA —— 一定交回人工

只有一次性的登录不值得自动化，而且 MFA 无法自动化。做法是第一次手工登录，
之后所有用例复用同一会话（`B2B_SESSION=reuse`，默认值）。

```js
await rec.step("进入系统", { op: "goto" });
await page.goto(ctx.url, { waitUntil: "domcontentloaded" });
const onLogin = /login|sso|signin/i.test(await page.url());
if (onLogin) {
  await rec.handoff("需要人工登录或短信验证");
  await session.handoff("停在登录页");
  await rec.finish("need-human", "等人工登录完成后重跑，登录态会被复用");
  return;
}
```

登录完成后重跑同一条用例即可：`session` 会复用同一个 TaskSpace；即使空间失效，
cookie 仍在浏览器 profile 里，通常也不需要重新登录。

需要彻底重来时：`b2b-test session close <环境名>`。

## 2. 权限矩阵 —— "看不到"也是结论

同一用例换角色跑，断言菜单或按钮**不可见**。这类断言最容易只测了正面。

```js
await rec.step("以只读角色检查操作按钮", { op: "verify" });
const canSeeDelete = await ego.visible(page, 'button:has-text("删除")');
await rec.check(
  "只读角色看不到删除按钮",
  !canSeeDelete,
  canSeeDelete ? "按钮出现了，权限可能配错" : "未出现，符合预期",
);
```

## 3. 列表 / 筛选 / 分页

筛选和翻页交给 Jev（它擅长"点哪个"），读结果交给自己：

```js
await rec.step("筛选出待审核订单", { op: "jev" });
const loop = await jev.run({
  goal: "把状态筛选为「待审核」并确认列表已刷新",
  values: { status: { value: "待审核", hint: "状态筛选" } },
  verify: async (p) =>
    (await p.evaluate(() => document.body.innerText.includes("待审核"))) === true,
});

await rec.step("核对筛选结果", { op: "verify" });
const rows = await ego.tableRows(page, "table");
const dataRows = (rows || []).slice(1); // 去掉表头
const allPending = dataRows.every((r) => r.join(" ").includes("待审核"));
await rec.check("结果全部是待审核", allPending, `共 ${dataRows.length} 行`);
```

分页同理：点"下一页"交给 Jev，翻页后核对**首行内容发生变化**，而不是只看页码文本。

## 4. 表单校验

负面用例往往比正面用例更有价值：

```js
await rec.step("留空提交，期望出现校验提示", { op: "jev" });
await jev.run({ goal: "直接点击提交按钮" });
const msg = await ego.textOf(page, ".ant-form-item-explain-error").catch(() => null);
const hinted = Boolean(msg) || (await ego.waitForText(page, "必填", { timeout: 3000 }));
await rec.check("空表单被拦下并给出提示", hinted, msg || "已出现提示");
```

## 5. 导出 / 下载

```js
await rec.step("导出当前列表", { op: "download" });
const dl = await ego.expectDownload(page, () => page.click('button:has-text("导出")'), {
  saveAs: `${ctx.caseDir}/导出结果.csv`,
  timeout: 30000,
});
await rec.check("导出文件已生成", Boolean(dl.savedAs), `${dl.suggestedFilename} → ${dl.savedAs}`);
```

`saveAs` 用绝对路径，通常放 `ctx.caseDir` 里，让证据跟着记录一起走。

## 6. 页面与接口对账 —— 专治"页面看着对、数据是错的"

```js
await rec.step("页面条数与接口条数对账", { op: "verify" });
const uiCount = await ego.countOf(page, "table tbody tr");
const api = await ego.apiJson(page, "/api/orders?page=1&size=20");
const apiCount = Array.isArray(api.json?.data) ? api.json.data.length : null;
await rec.check("页面条数等于接口条数", uiCount === apiCount, `页面 ${uiCount} / 接口 ${apiCount}`);
```

`apiJson` 用的是页面自己的 fetch（带 cookie、同源），拿到的是真实登录态数据。

## 7. 测试数据隔离

- 造数据带时间戳后缀，避免与真实数据混淆：`const tag = \`AUTO-${Date.now()}\`;`
- 尽量选可重复、可回滚的字段，不要占用真实业务编号
- 破坏性动作（删除 / 作废 / 支付 / 权限变更）默认被 `guard` 拦下并 escalate；
  确实需要时再显式放开，并在记录里写清楚

## 8. 失败时把现场留下

```js
if (!ok) {
  await rec.bad("保存后没有出现成功提示");
  await rec.shot("失败现场");
  await rec.note(await ego.pageText(page, 800));
}
```

`rec.bad()` 会把该步标红；再补一张截图和一段页面文本，复盘时就不用重跑。
