# @deepseek-ai/dsh-working-activity

[English](README.md) | 中文

为 DeepSeek Harness 打造的一条实时 "工作状态行"：模型的实时活动——俏皮思考文案、真正在跑的工具、已耗时、收尾摘要——在 agent 干活时展示出来。

## 功能

把持久会话流（`turn/start`、`assistant/chunk`、`tool/call`、`tool/result`、`turn/end`）和 `agent/status` 折叠成一条状态行，按渲染 tick 刷新：

- **思考中**：每隔几秒轮换一句短俏皮文案（`嗯…让我捋捋`、`盘一下盘一下`、`大脑转起来了`，穿插面无表情的 `lol` / `hm` / `ok`）；想久了自动分档（30 秒 / 1 分钟 / 5 分钟）；本地时间 00:00–06:00 混入深夜专属文案。
- **工具活动**：正在运行的工具渲染为 `俏皮动词 + 参数细节 + 已耗时`（`跑个命令 npm test · 12s`）；失败工具在收尾行显示 `翻车了` 风格文案。
- **收尾摘要**：`turn/end` 后状态行变为 `搞定 ✓ · N 工具 · 想Xs 干Ys`（思考/干活耗时拆分），并短暂钉住最后一个工具的片段。
- **极简模式**：`phrases: false` 时渲染朴素功能标签（`思考中 · 总1m23s`、`bash npm test · 12s`）。

两个可选出口，只有对应接缝存在时才会生效：

1. **TUI prompt 槽位** —— TUI 组合存在时，在 `ctx.tuiPrompt` 上注册 `${activity}` 模板值。把 `${activity}` 加进 `theme.leftPrompt` 即可在 `cwd`/`model`/`context` 旁边看到它。
2. **会话事件** —— 追加只记日志的 `activity/status` 事件（绝不是 surface 事件：模型永远看不到），供 Web 与其他 UI 消费；回放时忽略它们。

## 安装

```yaml
# cordis.yml
plugins:
  - id: working-activity
    name: '@deepseek-ai/dsh-working-activity'
```

Host 与 TUI 集成支持 DSH `0.1.0-rc.6`、`0.1.1-rc` 版本线和
`0.1.2-alpha.2`。可选 Web 客户端仍使用 rc 版 client-runtime 契约，不在
alpha.2 兼容范围内。

## TUI 用法

与 `dsh-tui` 一起启用插件，并把槽位加进左侧 prompt 模板：

```yaml
plugins:
  - id: tui
    name: '@deepseek-ai/dsh-tui'
    config:
      theme:
        leftPrompt: '${cwd}${git/worktree}${activity}${model}${token_meter/cache_hit_rate}${context}'
  - id: working-activity
    name: '@deepseek-ai/dsh-working-activity'
```

一轮进行中时，提示行显示例如 `dsh main 跑个命令 npm test · 12s deepseek-chat …`；思考时显示 `嗯…让我捋捋 · 总1m23s`；收尾后短暂显示 `搞定 ✓ · 4 工具 · 想12s 干11s`。模板里没有 `${activity}` 时，插件在 TUI 中不产生任何效果（槽位未注册的值会被模板渲染器省略）。

## Web 用法

Web 客户端通过 `activity/status` 事件以两种方式渲染实时状态行：

- 回合级状态标签（`TurnStatus`，原先是静态的 "Deep diving..."）：回合进行中显示实时状态行，保留原有的流光扫过特效。
- 输入区上方的状态行条目（`WorkingLine`，挂在 `conversation.input.dock`）：回合结束后渲染收工统计（token/耗时/工具摘要）；活动阶段只在轮辑标签上显示。

插件缺席时两者都回退到原来的静态标签，禁用插件不影响 Web UI。

## 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `phrases` | `boolean` | `true` | 俏皮文案池；`false` 渲染朴素功能标签 |
| `publish` | `boolean` | `false` | 为 UI 消费者追加 `activity/status` 会话事件。默认关闭：追加的事件目前会导致会话日志无法 resume（见下方说明） |
| `tickMs` | `number` | `500` | 状态渲染 tick 间隔（50–5000） |
| `publishIntervalMs` | `number` | `2000` | 状态行稳定时两次发布事件的最小间隔（500–30000） |
| `detailLimit` | `number` | `40` | 详情最大展示长度（路径/命令/模式），8–120 |
| `customActions` | `object` | `{}` | 工具名精确匹配 → 动作文案池，如 `{"my_deploy": ["部署一下", "上线中"]}` |
| `narrate` | `boolean` | `true` | 向 system prompt 注入 `⏵` 自述约定；该行实时展示并从聊天正文中过滤 |

## 事件契约

`activity/status` 是只记日志的会话事件（merge 可扩展的 `SessionEventMap` 成员，无 `surfaceOp`）：

```ts
{
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string            // 纯文本状态行，无 ANSI
  label?: string          // 当前工作标签（工具动作/阶段）
  detail?: string         // 路径 / 命令 / 模式片段
  phrase?: string         // 当前俏皮文案
  toolCount: number       // 本轮已完成的工具数
  turnElapsedMs: number   // 距本轮开始毫秒数
  phaseStartedAt: number  // 相位开始的 epoch 毫秒（动画锚点）
}
```

> **为什么 `publish` 默认关闭：** `session.append()` 无法把事件标记为 ignorable，而 resume 的读取路径会拒绝包含未知且不可忽略事件类型的日志——开启 `publish` 后，凡是显示过状态行的会话都会 resume 失败。仅在日志重放消费者、且 harness 支持 ignorable append 时再打开。TUI 实时状态行不受影响。

发布规则：状态行变化立即发布；稳定行最多每 `publishIntervalMs` 重发一次，让长工具的已耗时保持实时而不刷爆日志。所有数据都是无损 JSON；可选字段缺省时省略。

## 导出形状

函数/命名空间插件：`name` / `Config` / `apply`，无默认导出。状态机（`ActivityTracker`）与文案池在 `./status` 和 `./phrases`（纯逻辑、时钟注入、有单测）。不变量伴生插件在 `./invariant` 注册。

## Model Experience

### 提示词与工具面

没有。插件不注入任何提示词段、不注册任何工具、不追加任何 surface 事件。`activity/status` 只是 UI 状态：永不进入派生模型历史，模型看不到自己的工作状态行。

### Token 影响

每次请求为零。

### KV 缓存影响

不贡献 system prompt，因此无缓存稳定性影响。

## Known Limitations and Deferred Work

- **单条活跃状态行**：插件按会话维护一条状态行；TUI 槽位显示最近活跃会话。
- **自述可选**：`⏵` 模型自述约定（每次回复顶部写一行短状态文案）默认注入（`narrate: true`）；设 `narrate: false` 则只由事件推导。
- **无进度百分比**：DSH 没有工具进度事件；长工具只显示已耗时。
- **无动画帧**：TUI 槽位渲染静态文本片段；帧动画（moon/comet/braille 预设）要等 prompt 槽位契约支持帧回调后再做。
- **Web 双入口重复显示**：输入区 `WorkingLine` 与聊天区 `TurnStatus` 显示同一快照；dock 条目用于回合标签不可见的会话视图。
