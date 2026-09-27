# 可视化

记录是给人和智能体一起看的：纯文本 `report.md` 保证任何智能体都能读，
静态 HTML 保证人一眼能看懂。

## 三个视图

| 视图 | 文件 | 回答什么问题 |
|---|---|---|
| 全局看板 | `reports/index.html` | 一共跑了多少、通过率、批次列表、**同一个用例历次结果** |
| 批次报告 | `batches/<批次号>/batch.html` | 这一轮回归哪些过了、哪些没过、耗时与成本 |
| 用例记录 | `cases/<序号-用例名>/report.html` | 这一步到底做了什么、截图长什么样、为什么这样判定 |

对应还有 `.md` 版本（`batch.md` / `report.md`），内容等价、纯文本、便于 grep 和入 diff。

## 打开

```sh
b2b-test report --open     # 重新生成并打开全局看板
```

也可以直接双击 `reports/index.html`：**单文件、无 CDN、离线可开**，
截图用相对路径引用，所以整个批次目录打包发给别人也能看。

## 用例详情页长什么样

自上而下：

1. 结论徽章 + 批次回链
2. 元信息：用例描述、入口地址、结论说明、批次/用例、环境/执行者、起止时间、
   引擎版本（ego-browser 与 Jev 模型）
3. **判定**表：每条 `check` 的通过与否和理由
4. **执行过程**：纵向时间线，每步一行——序号、标签、操作、页面地址、耗时，
   右侧是该步截图缩略图，点击看原图；若该步跑了决策循环，额外显示
   `Jev: done / 3 步 / 4 次调用`
5. 页面错误与异常请求（有才显示）

时间线上 `❌` / `⚠️` 一眼可见失败与可疑步骤。

## 数据从哪来

看板是**扫描文件系统**生成的：读每个批次的 `batch.json`、每个用例的 `result.json`，
列出 `steps.jsonl`。没有独立的索引数据库，所以不存在"记录和索引不一致"的问题。
`reports/index.json` 只是同一份数据的机器可读快照，删掉也会重新生成。

结论不好看时，直接改 `result.json` 里的 `verdict` / `reason` 再跑一次
`b2b-test report` 即可——文件是唯一事实来源。

## 扩展到 CI

```sh
b2b-test exec "<用例目录>" --junit      # 额外生成 junit.xml
```

`junit.xml` 映射关系：`pass` → 通过；`fail`/`error` → `<failure>`；
`need-human`/`blocked` → `<skipped>`（并附原因）。退出码同样可直接用：

```
0 通过 · 1 失败/异常 · 2 需要人工 · 3 受阻 · 4 未完成
```

## 想改样式

样式与模板都在 `scripts/lib/report.mjs`：`STYLE` 常量是全部 CSS，`page()` 是外壳，
`renderCase` / `renderBatch` / `renderDashboard` 分别产出三个视图。
改完跑 `b2b-test test` 会验证报告仍能生成且不依赖 CDN。
