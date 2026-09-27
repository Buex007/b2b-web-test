# 初始化说明

目标：在一台**从没装过任何东西**的 Mac 上，把 ego lite、Jev 后端和本工具配置到
可以跑第一条用例的状态。

## 一条命令

```sh
sh install.sh
```

它会：把技能装到机器上已有的技能目录（软链或拷贝，见 `--copy`），然后运行
`bin/b2b-test init`。也可以只做其中一步：

```sh
sh install.sh --dry-run      # 先看会做什么，不动文件
sh install.sh --no-init      # 只安装
bin/b2b-test init            # 只初始化
```

## 初始化到底做了什么

`b2b-test init` 按顺序做七件事，每件都会打印 ✅ / ⚠️ / ❌：

| 步骤 | 内容 | 失败时怎么办 |
|---|---|---|
| 1 | 检查系统（macOS + CPU 架构） | 非 macOS 目前不支持 |
| 2 | 找 `ego-browser` 命令与 ego lite 安装 | 见下方「安装 ego lite」 |
| 3 | 探活运行时：`ego-browser nodejs -e '1'` | 打开 ego lite 完成首次引导 |
| 4 | 找 Jev 决策后端密钥 | 见下方「配置 Jev 后端」 |
| 5 | 写配置文件 `~/.config/b2b-web-test/config.env`（0600） | 已存在则保留不覆盖 |
| 6 | 体检（`b2b-test doctor`） | 按输出逐项修 |
| 7 | 离线自检（`b2b-test selfcheck`） | 不联网、不花钱；失败信息直接贴给执行者 |

## 安装 ego lite

`ego-browser` 命令由 ego lite 提供，所以它是硬前提。

**推荐：手动装一次**

1. 打开 <https://lite.ego.app/> 下载 macOS 版本
2. 安装后打开，完成首次引导（可选择从 Chrome 导入数据）
3. 引导过程中会把 `ego-browser` 注册到 `~/.local/bin`
4. 验证：`ego-browser --version`

**需要人工确认的两件事**（脚本无法代劳）：

- ego lite 的首次 GUI 引导——需要你点
- 如果被 Gatekeeper 拦下，去「系统设置 → 隐私与安全性」放行

**如果 `ego-browser` 不在 PATH**：

```sh
export PATH="$HOME/.local/bin:$PATH"      # 当前会话
# 想固定下来，就把这行写进你的 shell 配置（zsh 是 ~/.zshrc）
```

## 配置 Jev 后端

Jev 需要一个决策后端，而**密钥只能你自己去申请**（注册需要邮箱/可能要绑卡，
无法自动化）。拿到之后不必手改文件，一条命令搞定：

```sh
b2b-test key          # 选后端 → 粘贴密钥（不回显）→ 写入 0600 配置 → 立刻验证
b2b-test key check    # 只复查：来源、后端、是否有效
```

`b2b-test key` 会自动：

1. 列出三家后端和它们的注册地址
2. 读取你粘贴的密钥（去掉可能被一起复制进来的 `export VAR=` 和引号）
3. 按密钥形态判断后端（`sk-or-` 开头 → OpenRouter，否则 TypeSafe）
4. 写入 `~/.config/b2b-web-test/config.env`，权限 `0600`，保留文件里其它设置
5. **联网验证**这笔密钥是否被后端接受（不消耗生成额度），失败时说明原因

想手动配置也可以。密钥按以下顺序查找：

| 优先级 | 位置 | 变量名 |
|---|---|---|
| 1 | 本工具配置 `~/.config/b2b-web-test/config.env` | `B2B_JEV_API_KEY` |
| 2 | 环境变量 | `B2B_JEV_API_KEY` |
| 3 | 复用 ego-jev 的配置 `~/.config/ego-jev/secrets.env` | `TYPESAFE_API_KEY` / `AI_GATEWAY_API_KEY` / `OPENROUTER_API_KEY` |

后端自动判定：密钥以 `sk-or-` 开头走 OpenRouter，否则直连 TypeSafe。也可以显式指定：

```sh
B2B_JEV_BACKEND=typesafe     # 或 gateway / openrouter
B2B_JEV_BASE_URL=            # 自定义端点时填
B2B_JEV_MODEL=               # 指定模型
```

**没有账号怎么办**：注册后端账号这一步无法自动化，需要你自己完成。在此之前
`b2b-test selfcheck` 仍能验证整条链路（内置 mock 决策器，不联网、不消耗 token）。

## 验证装好了

```sh
b2b-test doctor      # 环境体检，全部 ✅ 即可
b2b-test selfcheck   # 离线自检：建工作目录 → 跑一步 → 出截图和报告
b2b-test report --open
```

`selfcheck` 通过的含义是：**工作目录、步骤记录、过程截图、结论、报告与看板这条链路是通的**。
它用本机 `file://` 页面加 mock 决策器，既不联网也不花钱。

想再验证真实后端（会消耗少量 token）：

```sh
b2b-test new "在 httpbin 表单里填写 Customer name 和 E-mail，确认字段已填入" --url https://httpbin.org/forms/post --label 冒烟
b2b-test exec "<用例目录>"
```

## 配置项一览

配置文件：`~/.config/b2b-web-test/config.env`（可由 `B2B_CONFIG` 指向别处）

| 变量 | 默认 | 说明 |
|---|---|---|
| `B2B_DATA_DIR` | `~/.local/share/b2b-web-test` | 记录根目录（`B2B_WEB_TEST_HOME` 亦可） |
| `B2B_BATCHES_ROOT` | `$B2B_DATA_DIR/batches` | 只改批次根目录时用 |
| `B2B_SHOTS` | `step` | 过程截图：`step` 每步一张 / `fail` 只留失败 / `off` |
| `B2B_SESSION` | `reuse` | `reuse` 复用登录态 / `fresh` 每次干净会话 |
| `B2B_MAX_STEPS` | `20` | 单次 Jev 循环的最大步数 |
| `B2B_ENV_NAME` | 空 | 环境名，如 `staging`（计入记录） |
| `B2B_AGENT` | 自动识别 | 执行者名字（计入记录） |

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 找不到 `ego-browser` | 没装 / 不在 PATH | 装 ego lite；`export PATH="$HOME/.local/bin:$PATH"` |
| `ego-browser nodejs` 报错 | 首次引导没做完 | 打开 ego lite 走完引导 |
| 找不到 Jev 密钥 | 三处都没有 | 见「配置 Jev 后端」；或先用 `selfcheck` |
| Jev 调用 401/403 | 密钥错或过期 | 换密钥；直连 TypeSafe 失败会自动回退网关 |
| 自检截图空白 | 页面没渲染完就截图 | 在 plan 里先 `waitForText` / `waitForSelector` 再截图 |
| 记录目录不可写 | 权限或磁盘 | 用 `B2B_WEB_TEST_HOME` 换到可写位置 |
| 升级 ego lite 后行为变化 | 版本切换 | 跑 `b2b-test doctor`；版本目录是软链，会自动跟随 |

## 卸载

```sh
sh uninstall.sh                # 只移除技能链接
sh uninstall.sh --purge-data   # 连记录一起删（会二次确认）
```
