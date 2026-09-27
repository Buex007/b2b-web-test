# 融合层设计与升级

## 三层分工

```
决策层  Jev（vendored 的 jev-loop.mjs）
        每步：快照 → 给可交互元素编号 → 一次调用选出「操作 + 目标」
        约 0.4–1.5s/步，不写文本、不看截图

执行层  ego-browser（TaskSpace / Page / 语义快照 / 选择器 / 截图 / fetch）
        提供原语，不参与决策

编排层  scripts/lib/（本工具新增的部分）
        工作目录、记录、判定、证据、报告、会话复用、成本记账
```

融合体现在三处：`scripts/lib/jev.mjs` 把后端与 planner 显式注入决策层；
`scripts/lib/recorder.mjs` 把决策层的每次结果自动写进记录；
`scripts/lib/session.mjs` 让登录态跨用例存活。三层之间没有隐藏状态。

## 为什么 vendor

本技能要能独立克隆、独立复现。如果运行时去引用另一个技能目录里的文件，它就变成
"必须与另一个仓库配套安装"，与「任何 Mac、任何智能体」的目标冲突。

所以 `scripts/vendored/jev-loop.mjs` 是逐字节复制的上游文件，同目录的
`PROVENANCE.json` 记录来源与 sha256。所有新增行为都在 `scripts/lib/`，
vendored 文件一行都不改——这样比对哈希就能精确判断漂移。

## 检查与升级

```sh
node scripts/sync-jev.mjs --check    # 与已安装的 ego-jev 比对
node scripts/sync-jev.mjs --update   # 用上游覆盖并刷新 PROVENANCE.json
```

`--check` 找不到本地 ego-jev 时会优雅退出（本技能不依赖它存在）；发现漂移返回非零，
便于放进 CI。

升级建议步骤：

1. `--check` 看差异
2. `--update` 更新文件与哈希
3. `b2b-test test`（纯逻辑自测）
4. `b2b-test selfcheck`（离线整链路）
5. 跑一次真实用例，看 `report.md` 里的 Jev 逐步 trace 是否符合预期

`b2b-test doctor` 也会校验 vendored 文件的哈希，本地被误改会当场提示。

## 后端与 planner 注入

上游会自己找密钥（读环境变量、读 `~/.config/ego-jev/secrets.env`、读 shell 配置），
但 ego 运行时拿不到调用者的环境变量，靠文件查找在多用户、多机器场景下不可靠。

因此本工具由启动器解析密钥与后端，通过 job 文件注入，`jev.run()` 里显式传
`backend` / `apiKey` / `baseUrl` / `model`。只有显式给了 `backend`，上游才会跳过
自动挑选逻辑。

planner（哪个智能体在驱动）同样由启动器识别后注入：先看环境标记
（`AI_AGENT`、`CLAUDECODE`、`CODEX_HOME` 等），再看父进程名，最后回落到
`--agent` 参数。它会被记进 `result.json` 与报告，所以"同一条用例换个人、换个智能体跑"
的差异能直接对比。

## 已知边界（不要期待它做这些）

- **不读内容、不写自由文本、不看截图**：这三类必然交回执行者
- **顺序执行**：一个 TaskSpace、一个 Page，不并行
- **Canvas / 复杂可视化页面**：语义快照里没有可用元素时会 `blocked`，
  这类页面需要单独写截图加坐标兜底
- **登录 / MFA / 验证码**：交回人工
- **成本**：约 9–11K 输入 token/步（实测一个 3 步用例约 9K 输入、2K 输出），
  记录里会汇总每次用例的调用次数与 token，便于估算批量回归成本
- **maxSteps 是硬上限**：默认 20；超长流程拆成多条用例，避免单次循环过深
