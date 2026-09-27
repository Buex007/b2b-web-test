# 可移植性与跨智能体

要求是「任何 Mac 用户 + 任何智能体都能用」。这不是口号，是一组硬约束的结果。
下面这些事实都是实测出来的，绕开它们写出来的脚本一定跑不起来。

## 能力契约

任何满足以下两条的智能体都可以驱动本工具，与它的品牌、工具名、模型无关：

1. 能执行 shell 命令
2. 能把 JS 脚本喂给 `ego-browser nodejs`（这一条由 `bin/b2b-test` 自己完成）

人也可以直接用同一套 CLI。

## 运行时硬约束（实测）

在 `ego-browser nodejs` 里：

| 事实 | 后果 |
|---|---|
| `process.cwd()` 恒为 `/` | 绝不能依赖相对路径 |
| 自定义环境变量不传递 | 不能用 `B2B_XXX=1` 给运行时传参 |
| `process.argv` 是 ego Helper 自己的 | 不能用位置参数传用例路径 |
| 脚本 stdout 走 fd 2 | 捕获输出必须 `2>&1` |
| 相对 `import` 在 stdin 入口脚本里失败 | 入口脚本必须用绝对 `file://` URL 导入 |

对应设计：**启动器解析一切，运行时只接收结果。**
`bin/b2b-test` 把工作目录、配置、密钥、模块 URL 作为字面量注入生成的 wrapper；
`scripts/lib/context.mjs` 从 wrapper 拿到一个 job 目录，读 `job.env`（KEY=value，
按第一个等号切分）与 `description.txt`（原文，不需要转义）。

副作用之一：因为密钥是显式注入的，运行时不需要 `$HOME` 也能工作，这让它
在不同用户、不同机器上的行为一致。

注意一条容易踩的：`ego-browser --version` 的输出走 stderr，捕获时同样要 `2>&1`。

## 路径解析规则

- 启动器用 `$0` 反查自身位置并解析软链，所以仓库克隆到哪都行，装成软链也没问题
- ego lite 的版本目录是软链 `~/.local/share/ego/active_version_dir`：每次运行时解析，
  绝不写死版本号，升级后自动跟随
- `ego-browser` 依次从 PATH、`~/.local/bin`、版本目录下的 `Helpers/` 查找
- 配置目录 `~/.config/b2b-web-test`，数据目录 `~/.local/share/b2b-web-test`，
  都可用环境变量覆盖；数据目录刻意不在仓库里，避免客户数据进 git

## 不依赖任何解释器

`bin/b2b-test` 是 POSIX sh：只用内建能力与 `command -v`。

不依赖 `jq`、`node`、`python`。干净 Mac 上这三个都可能没有——开发机上常见的
「python3 来自 Homebrew、node 来自 nvm」属于碰巧有，不能当前提。重活跑在
ego-browser 自带的 Node 运行时里。

`git` 只用于开发，运行链路不依赖它。

## 技能目录探测

`install.sh` 会探测这些位置，并链接到所有存在的技能目录（不同智能体看不同目录）：

- `~/.codex/skills`
- `~/.claude/skills`
- `~/.agents/skills`
- `$CODEX_HOME/skills`（设置了才用）

都不存在时创建 `~/.codex/skills`。默认软链（`git pull` 即生效），`--copy` 可改为拷贝。

## 跨智能体入口

- `SKILL.md`：支持 frontmatter 技能格式的智能体读它
- `AGENTS.md`：只读 `AGENTS.md` 类约定的智能体读它（同一件事的平铺版本）
- `agents/openai.yaml`：Codex 的界面元数据，只是附加信息，不是依赖

文档里不出现任何具体工具名（不写"用某个内置命令"），只描述能力。

## 可移植性怎么被验证

`b2b-test test` 里有一条专门的守卫：扫描随包文件，命中以下模式即失败——

- 硬编码的家目录（形如 `/Users/<名字>/...`）
- 写死的 ego lite 版本号
- 运行时文件里耦合到某个具体技能安装路径

另有两条：启动器必须是 POSIX sh（不出现 `[[` 测试、`source`、`jq`、`python`）；
`scripts/lib/` 下的库必须齐全且能被相对导入。

开发期辅助脚本（如 `scripts/sync-jev.mjs`）允许探测若干已知位置，它们会优雅降级，
不属于运行时链路，因此在守卫里显式豁免。

## 仍需要人的地方（诚实清单）

- ego lite 首次 GUI 引导、Gatekeeper 放行
- SSO / 短信 / MFA / 验证码
- Jev 后端账号注册

这几件事无法也不应该自动化；工具会 `handoff`，并在记录里写明"人工接管"。
