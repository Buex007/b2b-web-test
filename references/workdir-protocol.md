# 记录协议

**一次执行 = 一个目录。** 记录不是数据库里的一行，而是一个可以打包、可以归档、
可以整体删除的目录。全局视图是从文件系统扫描出来的，不存在第二个"索引"需要同步。

## 目录布局

```
~/.local/share/b2b-web-test/            # 数据根（仓库外）
├── batches/
│   ├── <批次号>/
│   │   ├── batch.json                  # 批次元数据与汇总
│   │   ├── batch.md / batch.html       # 批次报告与可视化
│   │   └── cases/
│   │       └── <序号-用例名>/          # 一次执行
│   │           ├── case.md             # 入口地址 + 用例描述原文
│   │           ├── plan.md             # 计划草稿（可改，非约束）
│   │           ├── plan.mjs            # 执行脚本
│   │           ├── steps.jsonl         # 步骤时间线（逐行追加）
│   │           ├── shots/              # 过程截图
│   │           ├── snapshots/          # 语义快照（需要时）
│   │           ├── result.json         # 结论（机器可读）
│   │           ├── junit.xml           # 可选，--junit 时生成
│   │           └── report.md / report.html
├── reports/
│   ├── index.html                      # 全局看板
│   └── index.json                      # 看板的机器可读快照
└── spaces/
    └── <环境>.json                     # 复用的浏览器会话（登录态）
```

`steps.jsonl` 是**边执行边追加**的：中途崩溃也留下可读的时间线，而不是空文件。
新建工作目录时 `result.json` 的结论是 `running`，所以"跑了但没跑完"在记录里是可见的，
不会被误当成通过。

## 批次标识符

批次号由工具生成（执行者不必手写），格式：

```
<yyyymmdd-HHMMSS>-<4位随机码>[-<标签>]
例：20260927-151657-8c0d-真实冒烟
```

- 前缀精确到**秒**，所以批次号本身就是可排序的时间键（`ls`、`--continue`、
  `prune --keep` 都靠它）
- 随机码消除同秒冲突；目录用 `mkdir` 原子抢占，两个执行者同秒启动也不会撞
- 尾巴是可选标签（`v2.3.1`、`冒烟`、`全量回归`），标签为空就不带
- 单条用例单独跑 = 只有一个用例的批次，不会产生"孤儿记录"

## 字段说明

### result.json

| 字段 | 含义 |
|---|---|
| `batchId` / `caseId` / `slug` | 三层标识（批次 / 序号-用例名 / 用例名） |
| `url` / `description` | 入口地址与用例描述原文（原样保留，便于对账） |
| `env` / `agent` / `engine` | 环境名 / 执行者 / 引擎版本（ego-browser 与 Jev 模型） |
| `startedAt` / `finishedAt` / `durationMs` | 时间信息 |
| `verdict` | `pass` / `fail` / `need-human` / `blocked` / `error` / `running` |
| `reason` | 结论说明（人写的，必须能读懂） |
| `steps` / `shots` | 步骤数 / 截图相对路径列表 |
| `checks[]` | 判定项：`{label, ok, detail}` |
| `errors[]` | 页面错误（未捕获异常、`console.error`）与执行器异常 |
| `network[]` | 4xx/5xx 请求与传输失败 |
| `jev` | 决策循环汇总：调用次数、token、状态分布、模型 |

### steps.jsonl（每行一个对象）

| 字段 | 含义 |
|---|---|
| `step` / `label` | 序号 / 这一步在做什么 |
| `op` / `target` | 操作类型（`goto`/`jev`/`verify`…）与目标（可空） |
| `status` | `ok` / `warn` / `fail` |
| `detail` | 说明：备注、失败原因、耗时表首行等 |
| `ts` / `durationMs` | 开始时间 / 耗时 |
| `url` | 该步结束时的页面地址 |
| `shot` | 该步截图（相对路径） |
| `jev` | 若该步跑了决策循环：`{status, reason, steps, calls, model, trace}` |
| `checks[]` | 该步产生的判定 |

`jev.trace` 是逐步决策记录（`op` / `ref` / `name` / 置信度），复盘"它为什么点了这里"时用它。

## 执行者判定 vs Jev 判定

Jev 返回 `done` 只表示"它认为点完了"。`result.json` 的 `verdict` 由执行者给出，
并且应当有 `checks[]` 与页面事实支撑。报告里两者都保留，互不覆盖。

## 保留策略

截图很占空间（一个十几步的用例可能几十 MB）。默认全部保留，按批次清理：

```sh
b2b-test prune --keep 10            # 只保留最近 10 个批次
b2b-test prune --days 30 --dry-run  # 先看会删什么
```

想省空间就全局改 `B2B_SHOTS=fail`（只留失败步骤的截图）或 `off`。

## 记录跟着项目走

```sh
b2b-test new "..." --url ... --out /path/to/project/test-runs
```

记录落在被测项目目录里，便于随 PR 一起归档。CI 里可以指向构建产物目录，
再用 `--junit` 输出 `junit.xml` 交给流水线。
