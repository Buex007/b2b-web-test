---
name: b2b-web-test
description: 用 ego-browser + Jev 执行 B 端（企业内部系统 / 管理后台 / SaaS 控制台）Web 测试——给一个入口地址加一段用例描述，逐用例执行，并在独立工作目录里留下过程截图、步骤时间线与结论，另生成可离线打开的可视化看板。适用于需要登录态的内部系统、表单/列表/筛选/导出/权限校验、以及要能回溯的回归验证。触发词：B端测试、web测试、回归测试、用例执行、自动化测试、测试记录、测试报告。
metadata:
  version: "0.1.0"
---

# b2b-web-test

一个把 ego-browser（执行）和 Jev（每步决定"点哪个"）焊在一起的 B 端测试工具：**用例怎么描述由人决定，点哪里由 Jev 决定，结论由执行者判定，记录由工具负责。**

## 何时用

- 要验证一个需要登录的企业系统/后台：跑一条或一批用例，并留下能复查的证据
- 回归验证：同一批用例反复跑，能按用例看历史趋势
- 需要把"页面看着对但数据是错的"这类问题挖出来（页面与接口对账）

不适用于：纯接口测试、不需要浏览器证据的单元测试、需要并行的压测。

## 三条不可动摇的约束

1. **不规定用例格式。** 输入就是「入口地址 + 用例描述」（自然语言）。不要为了迁就工具去写结构化用例文件。
2. **结论由执行者判定，不由 Jev 判定。** Jev 说 `done` 只是"我点完了"，必须用页面事实（文本、字段值、条数、接口返回）核对后再下结论。
3. **记录必须先于执行存在。** 先建工作目录，再执行；执行中途崩溃也要留下可读的时间线。

## 标准流程

```sh
# 0) 首次：初始化（装 ego lite、配 Jev 后端、跑离线自检）
b2b-test init

# 1) 为一条用例建工作目录（执行前就建好）
b2b-test new "登录后新建订单，确认列表出现该订单" --url https://crm.example.com --label 冒烟

# 2) 补全 <用例目录>/plan.mjs（骨架已生成，按描述改写）然后执行
b2b-test exec "<用例目录>"

# 3) 看记录
b2b-test report --open
```

批量跑同一批：第一条用 `--label v2.3.1`，后续用 `--continue` 挂到同一批次（批次号由工具生成，形如 `20260927-151657-8c0d-v2.3.1`）。

## plan.mjs 里有什么

执行脚本通过 `globalThis.B2B` 拿到全部能力：

| 名字 | 用途 |
|---|---|
| `B2B.ctx` | 入口地址 `url`、用例描述 `description`、目录、批次、环境、执行者（**不含任何密钥**） |
| `B2B.session` | `open()` 拿 TaskSpace 与 Page；登录态跨用例复用；`handoff(reason)` 交回人工 |
| `B2B.jev` | `run({goal, values, verify, maxSteps})` 跑一步决策循环，结果自动记入记录 |
| `B2B.rec` | `step/shot/note/check/jev/handoff/finish` —— 记录器的全部方法 |
| `B2B.ego` | 读页面：`textOf/valueOf/textsOf/countOf/tableRows/visible/waitForText/pageText/expectDownload/apiJson` |
| `B2B.finish` | 直接给结论（等价于 `rec.finish`） |

最小可用骨架：

```js
export default async function run() {
  const { ctx, rec, session, jev, ego } = globalThis.B2B;
  const { page } = await session.open();

  await rec.step("打开入口地址", { op: "goto" });
  await page.goto(ctx.url, { waitUntil: "domcontentloaded" });

  await rec.step("走到目标页面", { op: "jev" });
  const loop = await jev.run({
    goal: "打开「订单管理」页面",
    verify: async (p) => /orders/.test(await p.url()),
  });

  await rec.step("核对结果", { op: "verify" });
  const rows = await ego.tableRows(page, "table");
  await rec.check("列表有数据", Array.isArray(rows) && rows.length > 1, `rows=${rows?.length ?? 0}`);

  await rec.finish(rows?.length > 1 ? "pass" : "fail", "订单列表出现新订单");
}
```

## 分工（决定什么时候用 Jev，什么时候自己上）

| 场合 | 谁做 |
|---|---|
| 导航、点菜单/按钮/卡片、筛选、下拉、翻页、点列表行 | **Jev**（`jev.run`） |
| 填写已知值（账号、日期、编号、金额） | Jev 从 `values` 取值 |
| 写自由文本、读页面内容判断、处理弹窗/验证码 | **你自己**（`ego.*` + `page.*`） |
| 登录 / SSO / 短信 / MFA | **交回人工**：`session.handoff()`，然后以 `need-human` 收尾 |
| 下载文件、页面与接口对账 | **你自己**（`ego.expectDownload` / `ego.apiJson`） |

Jev **不读内容、不写自由文本、不看截图**；这两类必然交回来，这是分工不是缺陷。

## 记录在哪里

默认 `~/.local/share/b2b-web-test/`（仓库外，避免客户数据进入 git）：

```
batches/<批次号>/cases/<序号-用例名>/
  case.md  plan.md  plan.mjs  steps.jsonl  result.json
  shots/   snapshots/
  report.md  report.html
batches/<批次号>/batch.html
reports/index.html      ← 全局看板：所有批次 + 按用例的历史
```

细节见 [references/workdir-protocol.md](references/workdir-protocol.md)，看板见
[references/visualization.md](references/visualization.md)。用 `--out <目录>` 可以让记录跟着被测项目走。

## 参考文件（按需读）

- [references/initialization.md](references/initialization.md) —— 初始化：装 ego lite、配 Jev 后端、排错
- [references/portability.md](references/portability.md) —— 任意 Mac / 任意智能体的能力契约与硬约束
- [references/workdir-protocol.md](references/workdir-protocol.md) —— 记录字段协议
- [references/visualization.md](references/visualization.md) —— 看板怎么读、怎么扩展
- [references/b2b-patterns.md](references/b2b-patterns.md) —— 登录/权限/列表/导出/表单校验 的常用写法
- [references/jev-fusion.md](references/jev-fusion.md) —— 融合层设计、vendor 策略与升级

## 每次执行前自检

- 工作目录是否已经建好（`b2b-test new` 的产物），而不是边跑边建？
- 结论是否有页面事实支撑，而不是"Jev 说 done"？
- 不可逆动作（删除、支付、提交到生产）是否已经排除或用 `guard` 挡住？
- 凭据是否只存在于 `~/.config/`，没有写进用例目录？
