# b2b-web-test

用 **ego-browser + Jev** 跑 B 端（企业内部系统 / 管理后台 / SaaS 控制台）Web 测试：
给一个**入口地址**和一段**自然语言用例描述**，逐条执行，并在独立工作目录里留下
**过程截图 + 步骤时间线 + 结论**，另外生成一个可离线打开的可视化看板。

> B-end web testing driven by an AI agent, fusing [ego lite](https://lite.ego.app/)
> (browser execution) with Jev (per-step element decisions), keeping an auditable
> record for every case.

**MIT** · macOS · 零外部依赖（运行链路不需要 jq / node / python）

![测试看板](docs/dashboard.png)

*一个批次的看板：用例总数、通过率、每个用例历次结果、入口地址。*

## 这是什么

自动化测试长期卡在一个两难里：写脚本稳定但选择器一改版就全红、维护成本压在人身上；
让大模型"看截图点页面"灵活，但每步都要把截图和 DOM 塞进模型，又慢又贵。

这个工具换了个分工：

- **点哪里**交给 Jev（小模型逐步决策，约 0.4~1.5 秒一步）
- **读内容、写文本、判断对错、处理异常**交给执行者（AI 智能体或人）
- **记录**交给工具自己，不需要谁记得截图

它把"跑一遍测试"变成一份可复查的档案：每一步做了什么、页面长什么样、
为什么判定通过或失败，事后都能翻出来。

## 基于什么技术

| 层 | 技术 | 职责 |
|---|---|---|
| 执行层 | **ego-browser**（[ego lite](https://lite.ego.app/) 提供的 Chromium 命令） | 打开页面、语义快照、点击/填表/选择器、截图、页面内 fetch、TaskSpace 会话 |
| 决策层 | **Jev**（TypeSafe System One） | 每步：快照 → 给可交互元素编号 → 一次调用选出"操作 + 目标"。**不写文本、不看截图** |
| 编排层 | 本仓库 `scripts/lib/` | 工作目录与记录、会话复用、断言与证据、报告与看板、成本记账 |

关键数字（实测）：语义快照 8~20ms，单步决策约 0.4~1.5s，输入约 9~11K token/步。
相比"每一步都把截图交给大模型"，量级差 1~2 个数量级。

工程上的取舍：

- 启动器是 **POSIX sh**，不需要 `jq` / `node` / `python`，重活跑在 ego-browser 自带的 Node 运行时里
- 所有路径、密钥、版本都在**运行时解析**，不写死用户目录、不写死 ego lite 版本号
- Jev 的决策循环以 **vendored** 方式内置（逐字节复制 + sha256 留痕），仓库自包含、可复现

## 使用前提

### ⚠️ 只有两件事必须你亲自做

其余所有配置（装技能、初始化、建用例、执行、出报告）**都可以让 AI 代劳**，你只需要跟它说话。

| 必须你本人做 | 为什么 AI 代替不了 |
|---|---|
| **1️⃣ 下载并打开 ego lite，走完首次引导** | 首次引导是图形界面里的操作，脚本点不了；`ego-browser` 命令也由它注册 |
| **2️⃣ 拿一个 Jev 后端密钥** | 注册账号需要邮箱、可能要绑卡；而且密钥不该贴在聊天里让 AI 转手 |

另外两处 AI 会**主动来找你**，不需要你提前准备：浏览器里的登录 / 短信 / MFA 验证码、
以及 ego lite 被 Gatekeeper 拦下时的系统设置放行。

| 其它前提 | 说明 |
|---|---|
| **macOS** | ego lite 目前只支持 macOS |
| **`ego-browser` 在 PATH** | 通常在 `~/.local/bin`；AI 会检查，缺了会告诉你怎么补 |
| 不需要 | `jq`、`node`、`python`、`git`——运行链路都不依赖 |

**还没拿到密钥也能先跑通**：内置 mock 决策器可以离线跑整条链路（不联网、不花 token），
让 AI 跑一句 `b2b-test selfcheck` 就能证明工具链装好了。

### 1️⃣ ego lite（一次性，约 2 分钟）

1. 打开 <https://lite.ego.app/>，下载 macOS 版
2. 安装后**把它打开**，按引导走完（问你是否导入浏览器数据时可以跳过）
3. 引导过程中会把 `ego-browser` 命令注册到 `~/.local/bin`
4. 如果被 Gatekeeper 拦下：**系统设置 → 隐私与安全性 → 仍要打开**

装完可以让 AI 验证：对它说"跑一下 `b2b-test doctor`"。

### 2️⃣ Jev 密钥

这一步 AI 也帮不了你——注册账号它做不了。拿到之后**不用手改任何文件**，
AI 或你跑一条命令就配好了。

| 选 | 去哪 | 怎么做 |
|---|---|---|
| ① OpenRouter（推荐） | <https://openrouter.ai/settings/keys> | 注册 → 点 **Create Key** → 复制形如 `sk-or-v1-xxxx` 的串 |
| ② TypeSafe | <https://typesafe.ai/> | 注册 → 在控制台复制 API Key |
| ③ Vercel AI Gateway | <https://vercel.com/dashboard> | 打开 AI Gateway → 生成 API Key |

**怎么给工具**（⚠️ **不要贴进聊天窗口**）：

- **让 AI 运行 `b2b-test key`**，你在它打开的终端里直接粘贴（输入不回显）
- **或者你自己在终端跑 `b2b-test key`**

它会问你选哪一家 → 让你粘贴密钥（**输入不回显**）→ 自动判断后端 → 写入
`~/.config/b2b-web-test/config.env`（权限 `0600`）→ **立刻联网验证**这笔密钥是否被接受。
失败会直接告诉你原因（密钥不全 / 被拒绝 / 网络需要代理）。

粘贴时连 `export XXX_API_KEY="..."` 一起复制也没关系，它会自动剥掉变量名和引号。

如果确实不介意密钥留在对话记录里，也可以让 AI 执行
`b2b-test key set --stdin`，但**不推荐**。

**随时复查**

```sh
b2b-test key check     # 当前密钥来源、后端、是否有效（不消耗生成额度）
```

> 已经有 `~/.config/ego-jev/secrets.env`（另一个技能写的）也不用重复配置——
> 本工具会直接复用，并用 `b2b-test key check` 显示它来自哪里。

## 安装

**最省事的方式：直接让 AI 装。** 把仓库地址丢给它就行：

> 帮我安装并配置 b2b-web-test：仓库 `https://github.com/Buex007/b2b-web-test`，
> 装完跑 init 和 selfcheck，缺什么你自己处理，最后把结果告诉我。

自己手动装也很简单：

```sh
git clone https://github.com/Buex007/b2b-web-test.git ~/.codex/skills/b2b-web-test
sh ~/.codex/skills/b2b-web-test/install.sh
```

`install.sh` 会把技能链接到本机已存在的技能目录（`~/.codex/skills`、`~/.claude/skills`、
`~/.agents/skills`），然后运行初始化。可以先看一眼它会做什么：

```sh
sh install.sh --dry-run      # 只显示，不动文件
sh install.sh --no-init      # 只安装，不初始化
sh install.sh --copy         # 拷贝而不是软链
```

初始化与排错的完整说明见 [references/initialization.md](references/initialization.md)。

## 怎么使用

### 推荐姿势：你只说话，配置和执行都交给 AI

把下面这段复制给任意**能执行命令**的智能体（Codex、Claude Code、Cursor、自研 agent 都行）：

> 用 b2b-web-test 帮我跑一条 B 端用例。
> 入口地址：`https://你的系统地址`
> 用例描述：`你想验证什么，例如"登录后新建订单，确认列表出现该订单"`
>
> 配置和执行你自己做，**不要让我手动敲命令**；只有必须我本人操作的地方
> （ego lite 引导、Jev 密钥、浏览器里的登录/MFA）再来找我。

还没装过的话，先说这一句：

> 帮我配置 b2b-web-test：执行 `b2b-test init`，缺什么按提示处理，
> 最后跑一次 `b2b-test selfcheck` 把结果给我看。

### 分工：AI 做什么，你做什么

| # | 谁 | 动作 |
|---|---|---|
| 1 | **AI** | `sh install.sh` —— 把技能装到本机已有的技能目录（Codex / Claude / 共享目录都会链上） |
| 2 | **AI** | `b2b-test init` —— 检查 ego lite、写配置、跑离线自检；缺什么自己按提示处理 |
| 3 | **AI** | `b2b-test doctor` / `b2b-test key check` —— 自检环境与密钥状态 |
| 4 | **AI** | `b2b-test new "用例描述" --url <地址>` —— 执行前先建好工作目录 |
| 5 | **AI** | 补全 `<用例目录>/plan.mjs` —— Jev 负责"点哪里"，AI 负责读内容、判断结论 |
| 6 | **AI** | `b2b-test exec "<用例目录>"` —— 执行，过程截图与结论自动落盘 |
| 7 | **AI** | `b2b-test report --open` —— 把可视化看板给你看 |
| ⚠️ | **你** | 只在三处被叫到：**ego lite 引导**、**Jev 密钥**、**浏览器里的登录/MFA** |

也就是说：你正常只需要**说一句话 + 在浏览器里点几下登录**，其它都不用碰。

### 想确认 AI 有没有偷懒

> 跑 `b2b-test doctor`、`b2b-test selfcheck`，把原始输出贴给我；
> 没配密钥就先跳过，用 selfcheck 证明链路是通的。

`selfcheck` 不联网、不花 token，通过即说明**工作目录、步骤记录、截图、结论、报告与看板**
这条链路是通的。

### 全部手动也可以（AI 不在身边时）

```sh
# 0) 一次性：检查 ego lite、配 Jev、跑离线自检
b2b-test init

# 1) 为一条用例建工作目录（执行前就建好）
b2b-test new "登录后新建订单，确认列表出现该订单" --url https://crm.example.com --label v2.3.1

# 2) 补全 <用例目录>/plan.mjs（骨架已生成），然后执行
b2b-test exec "<用例目录>"

# 3) 打开可视化看板
b2b-test report --open
```

批量跑一轮回归：第一条用 `--label v2.3.1`，后续加 `--continue` 挂到同一批次。
批次号由工具生成，形如 `20260927-164614-9eaa-v2.3.1`。

### plan.mjs 里有什么

执行脚本通过 `globalThis.B2B` 拿到全部能力：

| 名字 | 用途 |
|---|---|
| `ctx` | 入口地址 `url`、用例描述 `description`、目录、批次、环境、执行者（**不含任何密钥**） |
| `session` | `open()` 拿 TaskSpace 与 Page；登录态跨用例复用；`handoff(reason)` 交回人工 |
| `jev` | `run({ goal, values, verify, maxSteps })` 跑一步决策循环，结果自动写进记录 |
| `rec` | `step / shot / note / check / jev / handoff / finish` |
| `ego` | 读页面：`textOf` `valueOf` `textsOf` `countOf` `tableRows` `visible` `waitForText` `pageText` `expectDownload` `apiJson` |

一个完整的用例（筛选 → 核对 → 与接口对账）：

```js
export default async function run() {
  const { ctx, rec, session, jev, ego } = globalThis.B2B;
  const { page } = await session.open();

  await rec.step("打开入口地址", { op: "goto" });
  await page.goto(ctx.url, { waitUntil: "domcontentloaded" });

  // 登录/MFA 不自动化：交回人工，然后用 need-human 收尾
  if (/login|sso|signin/i.test(await page.url())) {
    await rec.handoff("落在登录页，需要人工登录");
    await session.handoff("登录页");
    await rec.finish("need-human", "请人工登录后重跑，登录态会被复用");
    return;
  }

  // 点哪里交给 Jev
  await rec.step("筛选出待审核订单", { op: "jev" });
  const loop = await jev.run({
    goal: "把状态筛选为「待审核」，并确认列表已按该条件刷新",
    values: { status: { value: "待审核", hint: "状态筛选" } },
    verify: async (p) => await p.evaluate(() => document.body.innerText.includes("待审核")),
  });

  // 读结果交给自己，结论要有页面事实支撑
  await rec.step("核对筛选结果", { op: "verify" });
  const rows = await ego.tableRows(page, "table");
  const dataRows = (rows || []).slice(1);
  const allPending = dataRows.length > 0 && dataRows.every((r) => r.join(" ").includes("待审核"));
  await rec.check("结果全部是待审核", allPending, `共 ${dataRows.length} 行`);

  await rec.finish(allPending ? "pass" : "fail", allPending ? "筛选结果符合预期" : "出现非待审核数据");
}
```

更多 B 端套路（权限矩阵、分页、表单校验、导出下载、测试数据隔离）见
[references/b2b-patterns.md](references/b2b-patterns.md)。

### 记录长什么样

默认写在 `~/.local/share/b2b-web-test/`（**仓库外**，避免客户数据进 git）：

```
batches/<批次号>/cases/<序号-用例名>/
  case.md        入口地址与用例描述原文
  plan.md        计划草稿
  plan.mjs       执行脚本
  steps.jsonl    步骤时间线（边执行边追加）
  shots/         过程截图
  result.json    结论（机器可读）
  report.md      纯文本报告
  report.html    单文件可视化
reports/index.html   全局看板
```

![用例记录](docs/case-report.png)

*单条用例：结论、判定项、逐步时间线 + 每步截图。*

想让记录跟着被测项目走，加 `--out /path/to/project/test-runs`。

### 结论与退出码

`verdict` 取值为 `pass` / `fail` / `need-human` / `blocked` / `error` / `running`，
分别对应退出码 `0 / 1 / 2 / 3 / 1 / 4`，可以直接给 CI 用。

```sh
b2b-test exec "<用例目录>" --junit     # 额外生成 junit.xml
```

### 常用命令

| 命令 | 作用 |
|---|---|
| `b2b-test init` | 初始化：ego lite、Jev 后端、配置、离线自检 |
| `b2b-test doctor` | 环境体检 |
| `b2b-test new "<描述>" --url <地址>` | 建用例工作目录（执行前） |
| `b2b-test exec <目录>` | 执行并写记录 |
| `b2b-test selfcheck` | 离线自检整条链路（不联网、不花钱） |
| `b2b-test test` | 代码自测（纯逻辑） |
| `b2b-test ls` / `report` | 列出记录 / 生成并打开看板 |
| `b2b-test prune --keep 10` | 按批次清理旧记录 |
| `b2b-test session list` / `close` | 查看 / 关闭复用的登录态会话 |

## 不做什么（边界）

- **Jev 不读内容、不写自由文本、不看截图**：这三类必然交回执行者，是分工不是缺陷
- **不自动化登录 / MFA / 验证码**：交回人工，之后复用登录态
- **顺序执行**：一条用例一个会话，不并行、不做压测
- **Canvas / 复杂可视化页面**：语义快照里没有可用元素时会报 `blocked`，需要单独写坐标兜底
- **不做接口测试**：它是 Web 测试工具（虽然可以用 `ego.apiJson` 做页面与接口对账）

## 自测

```sh
b2b-test test        # 纯逻辑自测，含可移植性守卫
b2b-test selfcheck   # 离线整链路：建目录 → 跑一步 → 出截图和报告
```

`selfcheck` 用本机 `file://` 页面加内置 mock 决策器，不联网、不消耗 token，
通过即说明工作目录、步骤记录、截图、结论、报告与看板这条链路是通的。

## 更多文档

- [初始化与排错](references/initialization.md)
- [可移植性与跨智能体](references/portability.md) —— 任意 Mac、任意智能体都能用
- [记录协议](references/workdir-protocol.md)
- [可视化](references/visualization.md)
- [B 端常见场景写法](references/b2b-patterns.md)
- [融合层设计与升级](references/jev-fusion.md)

## 许可

**MIT** —— 见 [LICENSE](LICENSE)。

本仓库包含第三方代码：`scripts/vendored/jev-loop.mjs` 逐字节复制自 ego-jev（MIT），
未作任何改动。按上游声明：

> MIT. Policy, snapshot, and question text are derived from jev-ultrafast (MIT, Browser Use).

完整归属与维护约定见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
