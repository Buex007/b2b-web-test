# b2b-web-test

用 **ego-browser + Jev** 跑 B 端（企业内部系统 / 管理后台 / SaaS 控制台）Web 测试：
给一个**入口地址**和一段**自然语言用例描述**，AI 逐条执行，并在独立工作目录里留下
**过程截图 + 步骤时间线 + 结论**，另生成可离线打开的可视化看板。

> B-end web testing driven by an AI agent, fusing [ego lite](https://lite.ego.app/)
> (browser execution) with Jev (per-step element decisions), keeping an auditable
> record for every case.

![测试看板](docs/dashboard.png)

## 功能介绍

- **输入极简**：只要「入口地址 + 用例描述」（自然语言），不写结构化用例文件
- **分工明确**：Jev 决定"点哪个元素"，AI 负责读页面内容、写文本、判断对错、处理异常
- **逐用例留证**：执行前先建工作目录，内含 `case.md`（原始输入）、`steps.jsonl`（逐步时间线）、
  `shots/`（过程截图）、`result.json`（结论）、`report.md` / `report.html`（报告）
- **可视化**：单文件 HTML 看板，离线可开；既能看批次总览，也能看**同一个用例历次结果**
- **批次化回归**：批次号自动生成，一条命令挂到同一批次；退出码与 `junit.xml` 可直接进 CI
- **结论有依据**：Jev 的 `done` 只是"点完了"，必须用页面事实核对才算通过；
  失败自动留截图、页面错误与异常请求

![用例记录](docs/case-report.png)

*单条用例：结论、判定项、逐步时间线 + 每步截图。*

## 方案优势

- **便宜一个数量级**：语义快照 8~20ms、单步决策约 0.4~1.5s、约 9~11K token/步；
  相比"每一步都把截图交给大模型"，成本低 1~2 个数量级
- **不怕页面改版**：靠语义快照 + 元素编号定位，不依赖脆弱的 CSS 选择器，改版通常不用改脚本
- **人只在三处被叫到**：安装、配置、建目录、执行、出报告全部由 AI 完成；人只负责
  ego lite 引导、Jev 密钥、浏览器里的登录 / MFA
- **可回溯**：每一步的截图、页面地址、耗时、判定依据都留在记录里，"通过"不是一句话
- **可回归**：同一用例反复跑，看板能横向对比历次结果
- **可移植**：POSIX sh 实现，运行链路不需要 `jq` / `node` / `python`；任意 Mac 用户、
  任意能执行命令的智能体都能用。Jev 决策循环内置并留 sha256 指纹，仓库自包含
- **密钥安全**：只写入 `0600` 配置文件，不进仓库、不进用例记录；
  删除 / 支付等不可逆操作默认拦下并交回人工

## 和 AI 交互操作

### 一句话开跑（复制给 AI）

> 用 b2b-web-test 帮我跑一条 B 端用例。
> 入口地址：`https://你的系统地址`
> 用例描述：`你想验证什么，例如"登录后新建订单，确认列表出现该订单"`
>
> 配置和执行你自己做，**不要让我手动敲命令**；只有必须我本人操作的地方
> （ego lite 引导、Jev 密钥、浏览器里的登录 / MFA）再来找我。

还没装过，先说这一句：

> 帮我安装并配置 b2b-web-test：仓库 `https://github.com/Buex007/b2b-web-test`，
> 跑 `init` 和 `selfcheck`，缺什么你自己处理，最后把结果告诉我。

### AI 会做什么

| # | 谁 | 动作 |
|---|---|---|
| 1 | AI | 安装技能到本机技能目录（`install.sh`） |
| 2 | AI | `b2b-test init`：检查 ego lite、写配置、跑离线自检 |
| 3 | AI | `b2b-test new "用例描述" --url <地址>`：执行前先建好工作目录 |
| 4 | AI | 写执行脚本 `plan.mjs`，再 `b2b-test exec <用例目录>` 跑完 |
| 5 | AI | `b2b-test report --open`：把看板交给你 |
| ⚠️ | **你** | 只在三处被叫到：**ego lite 引导**、**Jev 密钥**、**登录 / 短信 / MFA** |

### 必须你亲自做的两件事

**1️⃣ ego lite（一次性，约 2 分钟）**

1. 打开 <https://lite.ego.app/>，下载 macOS 版
2. 安装后**把它打开**，按引导走完（问你是否导入浏览器数据时可以跳过）
3. 引导过程中会把 `ego-browser` 命令注册到 `~/.local/bin`
4. 如果被 Gatekeeper 拦下：**系统设置 → 隐私与安全性 → 仍要打开**

**2️⃣ Jev 密钥**：注册账号 AI 做不了。三选一：

| 选 | 去哪 | 怎么做 |
|---|---|---|
| ① OpenRouter（推荐） | <https://openrouter.ai/settings/keys> | 注册 → 点 **Create Key** → 复制形如 `sk-or-v1-xxxx` 的串 |
| ② TypeSafe | <https://typesafe.ai/> | 注册 → 在控制台复制 API Key |
| ③ Vercel AI Gateway | <https://vercel.com/dashboard> | 打开 AI Gateway → 生成 API Key |

⚠️ **不要把密钥贴进聊天窗口**。让 AI 运行 `b2b-test key`，你在它打开的终端里直接粘贴
（输入不回显）；或者你自己在终端跑 `b2b-test key`。它会自动判断后端、写入 `0600` 配置，
并**立刻联网验证**这笔密钥是否被接受。

### 让 AI 自证

> 跑 `b2b-test doctor` 和 `b2b-test selfcheck`，把原始输出贴给我。

`selfcheck` 不联网、不花 token，通过即说明**工作目录 → 记录 → 截图 → 结论 → 报告 → 看板**
这条链路是通的。更详细的用法见 [SKILL.md](SKILL.md) 与 [references/](references)。

## 许可

**MIT** —— 见 [LICENSE](LICENSE)。

本仓库包含第三方代码：`scripts/vendored/jev-loop.mjs` 逐字节复制自 ego-jev（MIT），
未作任何改动。按上游声明：

> MIT. Policy, snapshot, and question text are derived from jev-ultrafast (MIT, Browser Use).

完整归属与维护约定见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
