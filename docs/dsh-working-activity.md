# dsh-working-activity — DSH 实时工作状态行插件

非官方项目。DeepSeek Harness（DSH）的实时工作状态行插件：agent 工作期间，把会话的持久事件流与实时模型输出折叠成一行——当前相位文案、真正在跑的工具、已耗时、收尾摘要——并同时提供给终端 TUI、浏览器 Web UI 与桌面 GUI。

- 作者：chimney（[@ccch1mneyyy](https://github.com/ccch1mneyyy)）
- 包名：`dsh-working-activity`
- 许可证：BSD-3-Clause
- 当前目标宿主线：DSH `0.2.x`（`0.2.0-rc.2` / `0.2.1-rc.2`）；向下兼容 `0.1.7-rc.2`、`0.1.2-alpha.2`、`0.1.0-rc.6`

npm 包 README（功能、配置、契约的权威文本）：[英文](../packages/activity/working-activity/README.md) / [中文](../packages/activity/working-activity/README.zh.md)。

## 特性

- **四相位状态行**：`waiting` / `thinking` / `tool` / `done`；思考文案轮换、长思考分档（30s / 1m / 5m）、深夜、周末、节假日、稀有彩蛋、工具连击、模型切换梗与失败文案。
- **真实工具活动**：运行中的工具显示 `动词 + 参数细节 + 已耗时`；`tool/result` 按精确 call id 与 `tool/call` 配对；失败工具显示 `✗` 与失败文案。
- **收尾统计**：`turn/end` 后显示 `搞定 ✓ · N 工具 · 总Xm · 想Xs 干Ys`，并短暂钉住最后一个工具片段。
- **模型自述**：`narrate: true` 时注入 `⏵` 约定，实时提取并展示；聊天正文是否隐藏该行由界面决定，日志保留。
- **双语与特性开关**：`lang: auto | zh | en`；`mode: minimal` 或逐特性 `features` 开关。
- **任务级总用时**：`总` 跨用户插话累计。回合进行中用户的 next-turn 输入留在队列里，任务跨回合继续；回合结束且队列为空才结束任务。done 摘要的工具数、思考/干活耗时与 token 也按任务聚合。
- **紧凑 HUD**：`ctx 62%`（阈值加 `⚠` / `⛔`）、`2/5 待办`、后台任务、子代理 / Agent Team、目标轮次、计划模式、排队输入；逐项 `features` 开关，宿主没有的信号直接省略。
- **两条出口**：`workingActivity` 会话投影（TUI / Web UI / GUI，不写日志）；可选的工作状态日志记录（`publish: true`，供日志重放型消费者；`0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录，旧线降级为 legacy `activity/status` 事件）。

## 目录结构

```
packages/activity/working-activity/
  src/index.ts              插件入口：行配置、每会话 runtime、prompt 槽位、
                            自述段、发布出口
  src/status.ts             纯 ActivityTracker 状态机与渲染器
  src/phrases.ts            双语文案池
  src/frames.ts             帧预设（与 dsh-tui 共享）
  src/lang.ts               语言解析与文案字典
  src/config.ts             文件式配置解析器（dsh-tui 复用）
  src/projection.ts         workingActivity 会话投影
  src/events.ts             activity/status 事件 + plugin-record 类型合并
  src/registration.ts       旧走廊的会话事件类型注册垫片
  src/invariant.ts          可选的 dsh-invariants 伴生插件
  src/compat/               宿主载荷形状适配（session events / stream / tool result）
  src/client/               Web 客户端条目、WorkingLine 组件、本地耗时重算
  cordis.patch.yml          自挂载 bundle patch

packages/activity/working-activity-alpha2-compat/   0.1.2-alpha.2 隔离夹具
packages/activity/working-activity-rc2-compat/      0.2.1-rc.2 隔离夹具
```

## 安装

前置：官方 `dsh` CLI 与 `pnpm`（`dsh plugin` 把安装转发给 pnpm）。

### 安装到 profile

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

本包自带 `dsh.bundle.patch`（自挂载 bundle）：`add` 会在 profile 内执行 `pnpm add`，CLI 的 reconcile 步骤检测到 bundle 声明后，把包追加进 profile 的 `dsh.profile.bundles`。启动时，本包的 `cordis.patch.yml` 把自己 insert 进组合树，无需手动挂载。

等价的手动方式是 `cd $DSH_HOME/profiles/<profile> && pnpm add dsh-working-activity`，但 reconcile 只在 `dsh plugin` 命令里发生；手动安装后需要自己把包名加进 profile `package.json` 的 `dsh.profile.bundles` 列表。直接用 `dsh plugin` 更省事。

### 覆盖配置

在该 profile 的用户补丁层 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（顶层 YAML 数组）里按 id 覆盖 config，**不要 insert 同名行**：

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
    tickMs: 250
```

检查组合结果：

```sh
dsh --profile <profile> --dump-config
```

## 三个界面

| 界面 | 传输 | 落点 |
|---|---|---|
| TUI（`dsh-tui`） | `workingActivity` 投影 | `dsh-tui` 的 profile 通过 `@deepseek-harness-tui/dsh-tui/working-activity` 挂载本包，固定 `publish: false`，在状态行渲染投影值；同时复用本包的 `./frames` 帧预设与 `./config` 解析器。 |
| Web UI | `workingActivity` 投影 | `conversation.input.dock` 上的 `WorkingLine` 条目（id `activity`，order `15`），经 session 标准 kit 的 `useProjection('workingActivity')` 读取。 |
| 桌面 GUI | `workingActivity` 投影 | Tauri GUI 与 Web UI 共用 `platform: "web"` 客户端入口、dock 座位与投影读取；插件运行在内核 Web 客户端（React 18.3.1），peer 同时覆盖 React 18 / 19。 |

### TUI

TUI 支持随 `dsh-tui` 提供：`dsh-tui` 依赖本包，其 profile 通过 `@deepseek-harness-tui/dsh-tui/working-activity` 挂载，固定 `publish: false`，并从投影渲染状态行。把 `dsh-tui` 装进 profile 即可，不要向同一个 profile 再单独 add 本包：

```sh
dsh plugin --profile <profile> add @deepseek-harness-tui/dsh-tui
dsh --profile <profile>
```

插件在宿主组合了 `ctx.tuiPrompt` 服务时还会注册 `${activity}` prompt 值；提供 prompt 模板的宿主可以把它加进 `theme.leftPrompt`：

```yaml
- id: tui
  config:
    theme:
      leftPrompt: '${cwd}${git/worktree}${activity}${model}${context}'
```

当前 DSH 线不组合 `tuiPrompt`；在这条线上投影是 TUI 的唯一传输通道，该模板值是惰性的。

### Web UI

Web 端只有一段：客户端条目随 npm 包分发（`lib/client.js`）。Web 宿主启动时，client-module loader 扫描 loader 条目中的 `dsh.client` 声明，把 bundle 交给 shell；条目在 `conversation.input.dock` 上注册，渲染为 composer 卡片上方的一行暗色状态：

- 阶段色呼吸标记 + 宿主组合好的整行文案 + 本回合工具数；
- 首个值到达之前、或相位为 `idle` 时不渲染，不占位；
- 值为 `live` 时，客户端每秒本地重算耗时片段；片段形状无法识别时回退到宿主原文。

数据通道是 **session projection，不是会话日志**：node 半边把每个已提交事件折叠成 `workingActivity` 投影值，宿主把整个值（相位、`line`、工具数、时间戳）经 projection store 下发给客户端，浏览器用 `useProjection('workingActivity')` 读取。由此：

- **不为 Web UI 写会话日志**：不需要 `publish: true`，不会因为本包让日志不可恢复。
- **runtime 补丁已退役**：早期版本要求打过补丁的 `@deepseek-ai/dsh-client-runtime`（把 `activity/status` 事件搬到 `ConversationSnapshot.activity`）。该包冻结在 `0.1.1-rc.2` 且不在当前宿主线里；本包不再声明它，`ConversationSnapshot.activity` 的声明合并也已删除。投影是唯一通道。
- **耗时按事件刷新**：投影只在已提交事件折叠时变化；客户端用值里的 `phaseStartedAt` / `turnStartedAt` 本地重算。

### 桌面 GUI

桌面 GUI（`deepseek-harness-desktop`，Tauri）复用 Web 客户端入口：同一份 `dsh.client` 声明、同一个 `conversation.input.dock` 座位、同一次 `useProjection('workingActivity')` 读取，宿主侧同样是会话投影。要求与 Web UI 一致：组合 conversation / renderer / session 三个 boot row，并让 shell 的模块种子表提供 `react/jsx-runtime`。插件运行在内核 Web 客户端里（当前线是 React 18.3.1），不在 GUI 宿主的 React 树中；peer 范围同时覆盖 18 / 19。

已验证项与限制见 [GUI 兼容性](gui-compatibility.md)。

## 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `phrases` | `boolean` | `true` | 趣味文案池；`false` 渲染朴素功能标签 |
| `publish` | `boolean` | `false` | 追加工作状态日志记录供日志重放型 UI 消费：`0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录，旧线降级为 legacy `activity/status` 事件。第一方界面走投影，不需要它 |
| `tickMs` | `number` | `500` | 状态渲染 tick 间隔（100–5000） |
| `publishIntervalMs` | `number` | `2000` | 稳定行最小发布间隔（500–30000） |
| `detailLimit` | `number` | `40` | 展示细节最大长度（路径 / 命令 / 模式，8–120） |
| `customActions` | `object` | `{}` | 工具名 → 动作文案池（大小写不敏感） |
| `narrate` | `boolean` | `true` | 注入 `⏵` 自述约定并实时展示 |
| `lang` | `'auto' \| 'zh' \| 'en'` | `'auto'` | 文案语言；auto 依次读 `DSH_TUI_LANG`、`~/.dsh-tui/lang.json`、OS locale，最后回退 `zh` |
| `frames` | `string` | `'moon8'` | 帧预设名（供 UI 消费者读取） |
| `mode` | `'lively' \| 'minimal'` | `'lively'` | 花哨 / 极简 |
| `features` | `object` | `{}` | 单特性开关，显式值覆盖 mode 默认 |
| `customPhrases` | `string[]` | `[]` | 追加思考短语 |
| `showTokPerSec` | `boolean` | `false` | 流式 `~tok/s` 估算 |
| `workRemindAt` | `number` | `0` | 累计活跃 N 小时提醒休息（0–24，0 关闭） |
| `hud` | `boolean` | `true` | 紧凑 HUD 总开关；`false` 隐藏全部徽章 |
| `contextWarnAt` | `number` | `80` | 上下文压力达到该百分比时加 `⚠` |
| `contextDangerAt` | `number` | `95` | 达到该百分比时改用 `⛔` |
| `debugLog` | `boolean` | `false` | 渲染行 JSON 追踪日志（`~/.dsh-tui/working-activity-debug.log` 或 `DSH_WORKING_ACTIVITY_DEBUG_LOG`） |

`features` 支持：`phrases`、`rareEggs`、`nightPhrases`、`weekend`、`holidays`、`combo`、`failPhrases`、`modelQuips`、`continuePhrases`、`context`、`todos`、`jobs`、`subagents`、`team`、`goal`、`plan`、`queue`。

### HUD 信号

HUD 是状态行末尾的紧凑操作信息，不是第二个状态行。它从宿主日志自行折叠，不依赖其他 projection：

| 信号 | 来源 | 展示 |
|---|---|---|
| 上下文压力 | `request/context.contextWindow` + `assistant/message.usage` 的 prompt 桶 | `ctx 62%`；`contextWarnAt` / `contextDangerAt` 控制 `⚠` / `⛔` |
| 待办 | `todo/write` whole-list snapshot | `2/5 待办` |
| 后台任务 | `job/registered` / `job/settled`（0.1.7+） | `1 任务` |
| 子代理 | `subagent/catalog` | `1 子代理` |
| Agent Team | `team/member` / `team/task` | `1 团队`（优先于子代理徽章） |
| 目标 | `goal/change` | `目标 2/10`，完成后隐藏 |
| 计划模式 | `plan/mode` | `计划` |
| 排队输入 | `agent/inbox/spliced`（0.1.7+） | `+2 排队` |

`lively` 默认显示全部可用信号；`minimal` 只保留 `context`，其余需显式 `features` 打开。后缀最多四个徽章（`done` 五个），按 context → jobs → todos → team/subagents → goal → plan → queue 优先排序。`hud: false` 关闭全部。

### 任务总用时

`总` 记录的是任务，不是单条消息回合：

- 回合进行中用户插话时，DSH 把下一条输入放进 `next-turn` 队列；回合结束时队列非空，任务保持打开，下个回合继续累计。
- 回合结束且队列为空时任务结束；用户之后的新消息开启新任务。
- 任务级 done 摘要汇总工具数、思考/干活耗时与 token；`taskStartedAt` 暴露给客户端用于本地跳秒，`turnStartedAt` 仍表示当前回合的开始。任务边界依赖 `agent/inbox/spliced`（`0.1.7+`）；更早的宿主没有该信号时退回按回合计时。

## 投影契约

投影键：`workingActivity`。在宿主组合了 `sessionProjections` 服务时注册；没有投影注册表的 profile 会跳过，不报错。

DSH `0.2.x` 的注册定义：

```ts
{
  key: 'workingActivity',
  stateSchema,                  // 持久化折叠状态的校验
  stateVersion,                 // 持久化缓存失效版本
  init(header, inheritedEventCount),
  apply(state, event),          // 纯转换；无关事件返回同一引用
  wire: { viewSchema, view },   // 客户端值的校验与渲染
}
```

同一个定义对象同时携带旧注册表拼写（顶层 `schema` / `viewSchema` / `view`、零参数 `init`），因此无需运行时版本探测即可注册到四条宿主走廊。宿主提供 `stateOf(session, key)` 时，插件用它叠加只在实时阶段存在的事实（当前 `⏵` 自述、首 token 时刻）；没有该接口的宿主回退到已结算消息携带的自述。

客户端值：

```ts
interface WorkingActivityView {
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string
  live: boolean
  label?: string
  detail?: string
  phrase?: string
  toolCount: number
  phaseStartedAt: number
  toolStartedAt?: number   // 当前展示的（最旧）工具开始时刻
  taskStartedAt?: number   // 当前任务开始时刻（跨用户插话）
  turnStartedAt: number
  updatedAt: number
  lang: 'zh' | 'en'
}
```

`line` 是宿主折叠时的原文；`live` 表示该值对应的相位仍在进行、客户端可以本地重算耗时；`updatedAt` 是最后一次折叠事件的会话时间，用作新鲜度信号。`toolStartedAt` 单独存在，因为并发工具时展示的是最旧工具，而 `phaseStartedAt` 可能已被新工具更新。非 tool 相位的 `总` 从 `taskStartedAt` 计时；`turnStartedAt` 保留为当前回合的开始。

`view` 在连续读取字段完全相同时复用上一个 wire 对象；RC2 注册表用 `Object.is` 抑制“内部变化但展示值不变”的多余发布。

## 会话记录契约

`publish: true` 时追加只记日志的工作状态记录。**默认关闭**：第一方 TUI、Web UI 与 GUI 读取投影，只有日志重放型消费者需要它。

**DSH `0.2.x`（`0.2.0-rc.2` / `0.2.1-rc.2`）。** 写入走 `session.appendPluginRecord()`，记录类型 `plugin:working-activity/status`。宿主将其标记为 `ignorable: true`，无法识别的读取方会保留并跳过该记录，不会让会话无法 resume。

**旧走廊（`0.1.0-rc.6` 至 `0.1.7-rc.2`）。** 这些宿主没有 `appendPluginRecord`，插件自动降级为通过 `session.append()` 追加 legacy `activity/status` 事件。该代事件没有 ignorable 标记，因此加载时插件会把类型注册进所有可达的 `dsh-session` 副本（包括 persistence 校验器实际解析到的那份）以保证 resume 与持久化读取可用；注册幂等且无条件执行，也能读取早期 `publish: true` 写下的日志。若读取方解析到插件锚点无法触达的副本，仍存在残余风险；第一方界面不需要开启发布。

两种拼写的载荷相同：

```ts
{
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string
  label?: string
  detail?: string
  phrase?: string
  toolCount: number
  turnElapsedMs: number
  phaseStartedAt: number
}
```

两者都不带 `surfaceOp`，都不会进入派生的模型历史。

发布规则：状态行变化立即发布；稳定行最多每 `publishIntervalMs` 重发一次，让长工具的已耗时保持实时而不刷爆日志。可选字段缺省时省略，载荷为无损 JSON。

不变量伴生插件同时校验两种拼写：legacy `activity/status` 事件与当前 `plugin:working-activity/status` 记录。

## 兼容性

| DSH 宿主线 | TUI | Web UI | 桌面 GUI | 验证 |
|---|---|---|---|---|
| `0.1.0-rc.6` | 兼容维护¹ | 不支持 | 不支持 | legacy 投影形状测试、类型注册夹具 |
| `0.1.2-alpha.2` | 兼容维护¹ | 不支持 | 不支持 | `pnpm run test:alpha2` |
| `0.1.7-rc.2` | 支持 | 支持 | 不适用² | `pnpm run test:rc2` |
| `0.2.0-rc.2` | 支持 | 支持 | 支持³ | 主测试套件 + RC2 宿主夹具 + client bundle 门禁 + GUI 契约门禁 |
| `0.2.1-rc.2` | 支持 | 支持 | 支持³ | 主测试套件 + RC2 宿主夹具 + client bundle 门禁 + GUI 契约门禁 |

¹ 为兼容性维护，由隔离夹具 / 形状断言覆盖；主开发树不再针对该线编译。
² 桌面 GUI 使用 0.2.x 内核线。
³ 桌面 GUI 复用 Web 入口；GUI `0.22.4` 推荐 DSH `0.2.0-rc.2`，在 peer 范围内。详见 [GUI 兼容性](gui-compatibility.md)。

- TUI 支持取决于 `dsh-tui` 版本的 DSH 适配器；当前 `dsh-tui` 线以 `0.2.x` 为主目标，自行维护活动行 / 投影消费，并以 `publish: false` 挂载本包。
- Web UI 需要 `0.1.7-rc.2`、`0.2.0-rc.2` 或 `0.2.1-rc.2` 客户端编队。
- GUI 复用 Web 入口；插件运行在内核 Web 客户端（React 18.3.1），peer 覆盖 React 18 / 19。

### 0.2.x 迁移摘要

| 契约 | 变更 | 本包处理 |
|---|---|---|
| session projection 注册 | `stateSchema`、`stateVersion`、`init(header, inheritedEventCount)`、`wire.viewSchema` / `wire.view` | 单一继承定义同时携带新旧拼写 |
| 投影读接口 | `stateOf(session, key)` 仍存在 | 用于叠加实时自述与首 token 时刻 |
| 实时流 | `assistant/chunk` 不存在，增量走 `agent/assistant-stream` 帧 | `src/compat/assistant-stream.ts`；旧日志仍按 `assistant/chunk` 重放 |
| 工具结果 | `message.toolCallId` / `message.isError`（`source.callId` 等价） | `src/compat/tool-result.ts` 分层读取，兼容旧日志的 content block 形状 |
| 会话日志 | `SessionEvent.ignorable` 与 `appendPluginRecord` / `pluginRecordOf` | 已实现：`0.2.x` 写 ignorable `plugin:working-activity/status` 记录；旧走廊降级 legacy `activity/status` + 类型注册 |
| TUI 读取 | 无 `tuiPrompt` 服务；投影是唯一通道 | TUI 由 `dsh-tui` 挂载并读取投影 |
| GUI | Tauri；插件运行在内核 Web 客户端（React 18.3.1），复用 `platform: "web"` 客户端入口 | peer 范围 `^18.2.0 \|\| ^19.0.0` 同时覆盖内核与 GUI 宿主 |
| 失效项 | `dsh-client-runtime`、`ConversationSnapshot.activity`、`session.events` | 已移除 / 改用 `snapshotEvents()` |

## Web UI 挂载机制

```text
host Loader 条目（cordis.yml / bundle patch）
  → 包 package.json 声明 dsh.client: { platform: 'web', inject: [...] }
  → client-modules 扫描 ctx.loader.entries()，解析 exports["./client"]
  → 组合进 window.__DSH_BOOT__ 图，serve /plugins/<包名>/client.js
  → 浏览器端 ClientModuleSystem 加载 bundle（closure-factory 格式）
  → 包内 apply(ctx) 执行 → ctx.slots.register('conversation.input.dock', …)
  → 会话视图 composer 上方渲染工作状态行
```

关键约束：

- **subpath 必须是 `./client`**：client-modules 只解析 `exports["./client"]`（字符串或 `{ default }` 条件形式）。
- **必须声明 `dsh.client`**：`platform: 'web'`；`inject` 只列真实 boot row（conversation / renderer / session），不是 Cordis 服务注入。
- **bundle 必须是官方 closure-factory 格式**：产物调用 `window.__ModuleLoader__.load({ id, factory })`；CSS Modules 内联并自动注入 `<style data-plugin>`。
- **平台模块必须保持 external**：RC2 shell 的种子表是 `react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`-ui-slots`、`-ui-primitives`、`-ui-dockkit`。第三方 bundle 不得内联平台模块，否则运行时 identity 分裂。
- **bundle 缺失会 loud fail**：声明了 `dsh.client` 但 `lib/client.js` 不存在时，激活阶段抛 `MissingClientBundleError`。

## 开发与测试

```sh
cd packages/activity/working-activity
pnpm install --frozen-lockfile
pnpm run build              # host tsc + client tsc，产物进 lib/types/
pnpm run build:client       # 浏览器 bundle，产物 lib/client.js
pnpm test                   # 单元 + Host 集成测试
pnpm run verify:deps        # manifest 依赖门禁
pnpm run verify:lockfiles   # lockfile 一致性门禁
pnpm run verify:host-vocabulary
pnpm run verify:client-bundle
pnpm run verify:gui         # 桌面 GUI 契约（GUI 检出不存在时跳过）
pnpm run prepublishOnly     # 全部发布门禁
pnpm run test:alpha2        # 0.1.2-alpha.2 隔离夹具
pnpm run test:rc2           # 0.2.1-rc.2 隔离夹具
```

主开发树钉在 DSH `0.2.1-rc.2`（Cordis 4.0.5）。`test:alpha2` / `test:rc2` 各自使用独立 fixture 与锁文件加载已发布的 Host 图，避免把互斥 peer 图混装。父包重建后必须重装夹具（`pnpm run test:rc2` 已包含两步）。

## 隐私与安全

- 插件不采集、不上传任何数据；状态全部由本机会话事件推导。
- Web / GUI 走 `workingActivity` 会话投影（宿主内存中的投影值，不写日志）。
- `publish: true` 时写入本地会话日志：`0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录，旧线是只记日志的 `activity/status` 事件；两者模型均不可见，回放忽略。
- 无网络请求、无遥测；`customActions` 与文案只存在本地配置里。
- 许可证：BSD-3-Clause。

## 已知限制

- 单一状态行：每会话一条，界面显示最近活跃会话。
- 无进度百分比：DSH 没有工具进度事件，长工具只显示已耗时。
- 无动画帧：投影载荷是静态文本；指示器动画由 `dsh-tui` / Web 组件各自实现。
- Web 单入口：`conversation.input.dock` 状态行覆盖全部相位，无回合级标签。
- Web / GUI 的耗时由客户端本地重算；片段形状变化时回退到宿主原文，可能短暂滞后。
- 不变量伴生插件不会自动挂载：需要在 profile 用户层显式插入 `invariants` 与 `working-activity-invariant` 两行。
