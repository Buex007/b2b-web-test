# b2b-web-test

Cross-agent entry point. If your agent understands `SKILL.md` frontmatter, read
[`SKILL.md`](SKILL.md) instead — this file is the same thing in plain language,
for agents that only read `AGENTS.md`-style instructions.

## 这是什么

一个命令行工具，用 [ego lite](https://lite.ego.app/) 的 `ego-browser` 命令执行
浏览器操作，用 Jev（TypeSafe System One）决定每一步"点哪个元素"，并且把每次
用例执行留成一份可回溯的记录（截图 + 步骤时间线 + 结论 + 可视化看板）。

定位：**B 端 Web 测试**——需要登录的企业内部系统、管理后台、SaaS 控制台。

## 能力契约（满足这两条即可用，与智能体品牌无关）

1. 能执行 shell 命令
2. 能把一个 JS 脚本喂给 `ego-browser nodejs`（本工具自己会做这件事）

不需要 Codex、不需要 Claude、不需要任何特定工具名。`bin/b2b-test` 是一个
POSIX sh 脚本，只用 shell 内建能力，**不依赖 jq / node / python**。

人也可以直接用同一个 CLI。

## 怎么用

```sh
bin/b2b-test init                       # 一次性：装 ego lite、配 Jev 密钥、离线自检
bin/b2b-test new "用例描述" --url <地址>  # 执行前先建工作目录
#   改写 <用例目录>/plan.mjs，然后：
bin/b2b-test exec "<用例目录>"
bin/b2b-test report --open              # 打开可视化看板
```

其他：`b2b-test doctor`（体检）、`ls`（记录列表）、`selfcheck`（离线自检）、
`test`（代码自测）、`prune`（按批次清理）、`session list|close`（登录态会话）。

## 三条必须遵守的规则

1. **用例格式不做约束**：输入是「入口地址 + 自然语言描述」，不要硬套结构化格式。
2. **结论必须由你判定**，并用页面事实（文本/字段值/条数/接口）支撑；Jev 的
   `done` 只是"它点完了"。
3. **先建工作目录，再执行**；执行过程与结果都写进那个目录。

## 关键事实（踩过的坑，别再踩）

- 在 `ego-browser nodejs` 运行时里：`process.cwd()` 恒为 `/`，自定义环境变量
  **不传递**，`process.argv` 是它自己的，脚本的 stdout 走 **fd 2**。
  因此本工具由启动器把绝对路径注入生成的 wrapper，运行时不猜任何路径。
- ego lite 升级会改变 `~/.local/share/ego/active_version_dir`，所以版本号
  一律运行时解析，绝不写死。
- Jev 不写自由文本、不读页面内容、不看截图；这些交给执行者（你）。
- 登录 / MFA / 验证码必须交回人工：`session.handoff()`。

## 详细文档

- 初始化与排错：`references/initialization.md`
- 可移植性与跨智能体：`references/portability.md`
- 记录格式：`references/workdir-protocol.md`
- 看板：`references/visualization.md`
- B 端常见套路：`references/b2b-patterns.md`
- 融合层与升级：`references/jev-fusion.md`
