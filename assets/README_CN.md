[English](../README.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

Claude Code、Codex、OpenCode、Amp 和 pi-agent 的好友排行榜。追踪本地 coding agent 的 token 用量、费用、活跃状态和 agent 来源分布。

<img src="./demo.png" alt="ccclub" width="80%" />

## 开始

```bash
npx ccclub init
```

输入你的名字，拿到一个 6 位邀请码。发给朋友：

```bash
npx ccclub join YHAW6P
```

完事。ccclub 会创建一个轻量本地身份，自动识别本机支持的 coding agent 日志并同步用量。不需要密码，也没有传统的网页登录流程。

朋友加入后，查看排行榜：

```bash
ccclub
```

## 上传了什么

ccclub 读取本地已有的使用日志，打包成每 30 分钟的摘要（agent 来源 + token 数 + 费用），只上传这些数字。**不含提示词、不含代码、不含文件路径、不含项目名** — 只有计数器。运行 `ccclub show-data` 可以审查上传内容。

支持的数据源：

| Agent | 默认位置 |
|-------|----------|
| Claude Code | `~/.config/claude/projects`, `~/.claude/projects` |
| Codex | `~/.codex/sessions` |
| OpenCode | `~/.local/share/opencode` |
| Amp | `~/.local/share/amp/threads` |
| pi-agent | `~/.pi/agent/sessions` |

如果使用默认位置，不需要额外配置。自定义位置可以通过 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`OPENCODE_DATA_DIR`、`AMP_DATA_DIR` 和 `PI_AGENT_DIR` 设置。

## 命令

常用命令：

```bash
ccclub init                        # 一次性初始化，创建小组
ccclub join <邀请码>                # 加入朋友的小组
ccclub sync                        # 手动同步（会话结束也会自动跑）
ccclub sync --force                # 重新扫描并上传所有本地用量日志
ccclub                             # 看排行榜
```

排行榜选项：

```bash
ccclub -d 1                        # 时间窗口：1 / 7 / 30 / all
ccclub --no-cache                  # 不把 cache token 计入 token 总数
ccclub --all                       # 显示所有成员（包括今天没有使用记录的）
ccclub --global                    # 所有公开用户
ccclub -g YHAW6P                   # 指定小组
```

多设备和账号合并：

```bash
ccclub device link                 # 生成 24 小时有效的一次性 code，用来绑定另一台新终端
ccclub link ABCD2345               # 在新终端运行，绑定到同一个 ccclub 用户
ccclub merge-code                  # 生成 24 小时有效的一次性 code，用来合并已有账号
ccclub merge WXYZ6789              # 在要被合并的账号上运行，合并到 code 所属账号
```

个人资料和小组：

```bash
ccclub create                      # 再建一个小组
ccclub leave [邀请码]               # 离开某个小组
ccclub profile                     # 看个人资料
ccclub profile --name "新名字"      # 改显示名
ccclub profile --avatar "URL"      # 自定义头像
ccclub profile --public            # 出现在全球榜
ccclub profile --private           # 从全球榜隐藏（默认）
ccclub profile --plan max100       # 设置订阅计划：pro / max100 / max200 / api / none
ccclub profile --url "https://..." # 让显示名链接到 GitHub、主页等 URL
ccclub show-data                   # 看具体上传了什么
ccclub hook                        # 必要时重新安装 Claude Code 自动同步 hooks
```

## 网页看板

每个小组有一个实时页面：

```
https://ccclub.dev/g/YHAW6P
```

可切换 today/yesterday/7d/30d/all time，有头像、活跃状态、agent 分布、活动图表，每 5 分钟自动刷新。公开用户的全球页面在 `/g/global`。

## 多台电脑

这里有两种不同场景：

**新终端，绑定到同一个 ccclub 用户**

在已经初始化过的终端上运行：

```bash
ccclub device link
```

然后在新终端上运行它打印出来的命令：

```bash
ccclub link ABCD2345
```

这个 code 是一次性的，24 小时有效。新的安装会生成本地 `deviceId`，所以每台电脑写入自己的用量 bucket。老版本没有 `deviceId` 的安装会继续走原来的 legacy 同步路径，已有数据不会被破坏。

**两台电脑之前已经初始化成了两个不同账号**

在你希望保留名字、头像和资料的账号上运行：

```bash
ccclub merge-code
```

然后在要被合并的账号上运行它打印出来的命令：

```bash
ccclub merge WXYZ6789
```

merge code 也是一次性的，24 小时有效。已有用量不会搬迁、删除或重写；worker 只写一个轻量 alias，排行、活动图、网页 metadata 和 OG 图在读取时合并，并展示保留下来的账号资料。

## 隐私

**只上传**这些：

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T00:30:00Z",
  "source": "codex",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
  "reasoningTokens": 0,
  "totalTokens": 91460,
  "costUSD": 0.2184,
  "models": ["gpt-5"],
  "entryCount": 23,
  "chatCount": 8
}
```

**默认隐私** — 你只出现在自己加入的小组里。全球榜需要主动开启（`ccclub profile --public`）。

## 架构

```
packages/
  shared/     类型 + 常量
  cli/        ccclub — Commander.js CLI
  worker/     Cloudflare Worker — Hono API + KV + 看板
```

自动同步：`ccclub init`、`ccclub join` 和 `ccclub link` 会安装 Claude Code `SessionEnd` + `Stop` hooks，并安装一个轻量后台同步，让 Codex、OpenCode、Amp 和 pi-agent 的用量也保持新鲜（每 5 分钟限频一次）。

## 开发

```bash
pnpm install
pnpm build
pnpm dev:worker                    # localhost:8787

# 另开终端
CCCLUB_API_URL=http://localhost:8787 ccclub init
```

## 许可证

MIT
