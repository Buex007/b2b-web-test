# 第三方代码与来源声明

本仓库包含第三方代码，按 MIT 许可分发。下列上游声明按原样保留。

> 为什么归属声明写在这个文件里、而不是塞进 `LICENSE`：`LICENSE` 保持 MIT 标准原文，
> GitHub 才能自动识别为 MIT；一旦在里面追加额外段落，许可证检测会退化成
> `NOASSERTION`（本仓库踩过这个坑）。归属与许可是两件事，分开放也更清楚。

## 1. Jev 决策循环（vendored）

| 项 | 内容 |
|---|---|
| 文件 | `scripts/vendored/jev-loop.mjs` |
| 来源 | **ego-jev** 技能中的 `scripts/jev-loop.mjs` |
| 许可 | **MIT** |
| 上游声明 | **MIT. Policy, snapshot, and question text are derived from jev-ultrafast (MIT, Browser Use).** |
| 修改 | **无**。逐字节复制，未作任何改动——这样 `scripts/sync-jev.mjs --check` 可以直接比对哈希 |
| 可核验 | sha256 与复制日期记录在 `scripts/vendored/PROVENANCE.json` |

该文件内部的具体派生关系：

- **policy、snapshot、question text** 派生自 **jev-ultrafast**（由 **Browser Use** 提供，MIT）
- 可交互元素的识别分层（`ClickableElementDetector`）建模自 **browser-use**
- 每类操作单独裁剪候选元素（per-op heads）沿用 **jev-ultrafast** 的做法

## 2. 本仓库自己的代码

除上述第三方文件外，其余代码由本仓库作者编写，同样以 **MIT** 分发，见 [LICENSE](LICENSE)。

## 维护约定

- **不要给 vendored 文件加注释或许可头**：它会破坏逐字节一致性，漂移检查会失败。归属声明放在本文件里。
- 升级时用 `node scripts/sync-jev.mjs --update`，它会同步刷新 `PROVENANCE.json` 里的 sha256。
- 本文件中的上游声明请保持原样，不要改写措辞。
