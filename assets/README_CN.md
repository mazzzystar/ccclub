[English](../README.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

看看朋友们用 Claude Code 烧了多少 token。

<img src="./demo.png" alt="ccclub rank" width="80%" />

## 开始

```bash
npx ccclub init
```

输入你的名字，拿到一个 6 位邀请码。发给朋友：

```bash
npx ccclub join R4NK7D
```

完事。用量每小时自动同步，不用配置，不用注册，不用建号。

朋友加入后，查看排行榜：

```bash
ccclub rank
```

## 原理

```
~/.claude/projects/*.jsonl → 聚合成 5 小时块 → 上传 → 一起看
```

Claude Code 在本地写 JSONL 日志，CCClub 把它们打包成 5 小时的摘要（token 数 + 费用），上传这些数字。**不含提示词、不含代码、不含文件路径、不含项目名** — 只有计数器。运行 `ccclub show-data` 可以在同步前审查上传内容。

## 命令

日常用这四个就够了：

```bash
ccclub init                        # 一次性初始化，创建小组
ccclub join <邀请码>                # 加入朋友的小组
ccclub sync                        # 手动同步（每小时也会自动跑）
ccclub rank                        # 看今天的用量
```

更多时间范围：

```bash
ccclub rank -p weekly              # 本周
ccclub rank -p monthly             # 本月
ccclub rank -p all-time            # 全部
ccclub rank --global               # 所有公开用户
ccclub rank -g R4NK7D              # 指定小组
```

想折腾的话，这些也有：

```bash
ccclub create                      # 再建一个小组
ccclub profile                     # 看个人资料
ccclub profile --name "新名字"      # 改显示名
ccclub profile --avatar "URL"      # 自定义头像
ccclub profile --public            # 出现在全球榜
ccclub profile --private           # 从全球榜隐藏（默认）
ccclub show-data                   # 看具体上传了什么
```

## 网页看板

每个小组有一个实时页面：

```
https://ccclub.dev/g/R4NK7D
```

可切换日/周/月/全部，有头像，每 5 分钟自动刷新。公开用户的全球页面在 `/g/global`。

## 隐私

**只上传**这些：

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T05:00:00Z",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
  "totalTokens": 91460,
  "costUSD": 0.2184,
  "models": ["claude-sonnet-4-5-20250929"],
  "entryCount": 23
}
```

**默认隐私** — 你只出现在自己加入的小组里。全球榜需要主动开启（`ccclub profile --public`）。

## 架构

```
packages/
  shared/     类型 + 常量
  cli/        npx ccclub — Commander.js CLI
  worker/     Cloudflare Worker — Hono API + KV + 看板
```

心跳：macOS LaunchAgent 每小时执行 `ccclub sync --silent`。

## 开发

```bash
pnpm install
pnpm build
pnpm dev:worker                    # localhost:8787

# 另开终端
CCCLUB_API_URL=http://localhost:8787 npx ccclub init
```

## 许可证

MIT
