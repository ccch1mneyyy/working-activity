# dsh-working-activity

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/dsh-working-activity)](https://www.npmjs.com/package/dsh-working-activity)
[![CI](https://github.com/ccch1mneyyy/working-activity/actions/workflows/ci.yml/badge.svg)](https://github.com/ccch1mneyyy/working-activity/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-working-activity)](LICENSE)
[![node](https://img.shields.io/node/v/dsh-working-activity)](package.json)

DeepSeek Harness（DSH）的实时工作状态行插件。agent 工作期间，插件把会话的持久事件流与实时模型输出折叠成一行：当前相位文案、真正在跑的工具、已耗时，以及回合结束摘要。

所有组合了本插件的界面渲染的都是同一行：终端界面（`dsh-tui`）、浏览器 Web UI 与桌面 GUI。浏览器与桌面端读取**会话投影**，不会为此向会话日志追加任何内容。

| | |
|---|---|
| 包名 | `dsh-working-activity` |
| 宿主 | DSH `0.1.0-rc.6` 至 `0.2.1-rc.2`（见[兼容性](#兼容性)） |
| 界面 | TUI · Web UI · 桌面 GUI |
| 传输 | 会话投影 `workingActivity`；可选的 ignorable `plugin:working-activity/status` 记录 |
| 运行时 | Node `^22.19 \|\| >=24` |
| 许可证 | BSD-3-Clause |

## 目录

- [功能](#功能)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装](#安装)
  - [TUI](#tui)
  - [Web UI](#web-ui)
  - [桌面 GUI](#桌面-gui)
- [配置](#配置)
- [投影契约](#投影契约)
- [会话记录契约](#会话记录契约)
- [兼容性](#兼容性)
- [架构](#架构)
- [开发](#开发)
- [故障排查](#故障排查)
- [隐私与安全](#隐私与安全)
- [许可证](#许可证)

## 功能

- **相位感知的状态行。** 状态行按 `waiting` → `thinking` → `tool` → `done` 移动。每个相位有独立的文案池、轮换节奏与耗时格式；已结算的相位展示固定的收尾摘要，而不是继续计数的计时器。
- **真实的工具活动。** 运行中的工具渲染为*动词 + 参数细节 + 已耗时*（`跑个命令 npm test · 12s`）。结果与调用按精确 call id 配对；失败的工具使用失败文案并带 `✗` 标记。
- **回合摘要。** `turn/end` 后状态行变为 `搞定 ✓ · 4 工具 · 想12s 干11s`——完成工具数、思考耗时与干活耗时——并短暂钉住最后一个工具的片段。
- **实时自述。** `narrate` 默认开启：插件注入一条简短的系统提示词约定，要求模型在每个步骤开始时写一行 `⏵ …`。该行实时显示在状态行中，持久消息里仍然保留它。
- **双语、按特性开关的文案。** 中英文案池、日间/深夜变体、长思考分档、周末与节假日文案、稀有彩蛋、工具连击、模型切换梗与失败文案都可独立开关。`phrases: false` 或 `mode: minimal` 渲染朴素功能标签。
- **构造上无侵入。** 插件不注册工具、不追加 surface 事件、不进入派生的模型历史。它唯一可能影响提示词的部分是可选的自述约定。
- **可选的不变量伴生插件。** `./invariant` 校验本包自己的活动快照——legacy `activity/status` 事件与当前 `plugin:working-activity/status` 记录两种拼写——检查相位词表、非空 `line` 与有限非负指标，覆盖已加载会话以及之后的每次追加。
- **一次折叠，三个界面。** node 半边持有状态机；TUI、Web UI 与 GUI 只渲染投影值，没有界面重新实现相位逻辑。

## 工作原理

node 半边为每个会话维护一个 `ActivityTracker`，输入有三类：

1. **持久会话事件**——`turn/start`、`step/start`、`assistant/message`、`tool/call`、`tool/result`、`turn/end`、`assistant/attempt`、`model/selection`，以及压缩、审批与重试信号。
2. **实时 assistant-stream 帧**——`agent/assistant-stream`（`start` / `chunk` / `end`）。当前宿主线上，流式增量、首 token 时刻与 `⏵` 自述都由这些帧承载。
3. **agent 状态**——`agent/status`（`idle` / `running`）。

tracker 渲染一行纯文本，并通过两条通道对外提供同一个值：

- **投影**——`workingActivity` 会话投影折叠持久日志并发给客户端。这是 TUI、Web UI 与 GUI 的传输通道。
- **持久记录**——`publish: true` 时，渲染出的快照还会作为只记日志的记录追加，供重放会话日志的消费者使用。在 DSH `0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录；旧走廊使用 legacy `activity/status` 事件。

| 相位 | 进入条件 | 示例行 |
|---|---|---|
| `waiting` | 回合已开启，模型尚未产出 token | `等待模型响应 · 总3s` |
| `thinking` | 收到实时 token 或 reasoning 增量 | `嗯…让我捋捋 · 总12s` |
| `tool` | 有 `tool/call` 尚未收到结果 | `跑个命令 npm test · 12s` |
| `done` | 回合已结束 | `搞定 ✓ · 4 工具 · 想12s 干11s` |
| `idle` | 没有进行中的回合 | *（不渲染）* |

## 环境要求

- 组合了 agent loop 与至少一个界面（TUI、Web UI 或 GUI）的 DSH profile。
- Node `^22.19 || >=24`。
- 官方 CLI 安装 profile 插件时会调用 `pnpm`。

## 安装

本包是**自挂载 bundle**：声明了 `dsh.bundle.patch`（`cordis.patch.yml`），官方 CLI 既安装本包，也会把它追加到 profile 的 bundle 层列表。启动时，bundle patch 把 `working-activity` 行插入组合树，无需手动挂载。

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

要调整配置，请在 profile 的用户层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）**按 id** 覆盖该行的 `config`，不要插入第二个同 id 行：

```yaml
- id: working-activity
  config:
    tickMs: 250
    publishIntervalMs: 500
```

检查组合结果：

```sh
dsh --profile <profile> --dump-config
```

### TUI

TUI 支持随 `dsh-tui` 提供。`dsh-tui` 依赖本包，其 profile 通过 `@deepseek-harness-tui/dsh-tui/working-activity` 挂载（该子路径是 re-export，并把 `publish` 固定为 `false`），从 `workingActivity` 投影渲染工作状态行。`dsh-tui` 还复用本包的 `./frames` 预设与 `./config` 解析器，用于帧选择器和 `~/.dsh-tui/working-activity.json` 设置。

把 `dsh-tui` 装进 profile 即可；本插件作为它的依赖自动到达，不要向同一个 profile 再单独 add 一次：

```sh
dsh plugin --profile <profile> add @deepseek-harness-tui/dsh-tui
dsh --profile <profile>
```

宿主直接组合本包时也可独立使用；宿主提供 `ctx.tuiPrompt` 时，插件会注册 `${activity}` 模板值，可在 prompt 模板中这样启用：

```yaml
- id: tui
  config:
    theme:
      leftPrompt: '${cwd}${git/worktree}${activity}${model}${context}'
```

当前 DSH 线不组合 `tuiPrompt`；在这条线上，投影是 TUI 的唯一传输通道，上述模板值是惰性的。

### Web UI

把插件装进组合了 Web 客户端的 profile，然后启动该 profile（官方 `web` profile 也可以直接 `dsh web`）：

```sh
dsh plugin --profile <profile> add dsh-working-activity
dsh --profile <profile>
```

浏览器半边是一个客户端 bundle（`lib/client.js`，随包发布）。宿主的 client-module loader 会扫描 loader 条目中的 `dsh.client` 声明，并把 bundle 交给 shell。bundle 在 `conversation.input.dock` 上注册一个条目——id `activity`、order `15`——渲染为 composer 上方的一行暗色状态：

- 相位色呼吸标记、宿主组合好的整行文案、本回合工具数；
- 首个值到达之前、以及相位为 `idle` 时不渲染；
- 值处于 `live` 时，已耗时片段每秒在客户端本地重算——因为投影本身只在已提交事件折叠时才变化。

本包声明的客户端编队：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-session"
    ]
  }
}
```

`dsh.client.inject` 列的是**启动行（boot row）**——必须先到达的包依赖——不是 Cordis 服务注入。客户端插件自己导出的 `inject` 是 `['slots']`。`@deepseek-ai/dsh-client-ui-slots` 是 shell 的种子模块，不是 boot row，因此不出现在 `dsh.client.inject` 中。

### 桌面 GUI

桌面 GUI（`deepseek-harness-desktop`，Tauri）复用 Web 客户端入口：同一份 `platform: "web"` 声明、同一个 `conversation.input.dock` 座位、同一次 `useProjection('workingActivity')` 读取，宿主侧同样是会话投影。插件运行在内核 Web 客户端里（当前线是 React 18.3.1），不在 GUI 宿主的 React 树中；`react` peer 范围（`^18.2.0 || ^19.0.0`）同时覆盖两者，React 19 宿主不会把第二份 React 副本带进 bundle。

GUI 侧的要求与 Web UI 相同：组合上文三个 boot row，并让 shell 的模块种子表提供 `react/jsx-runtime`。已验证的契约、证据与已知限制见 [`docs/gui-compatibility.md`](../../../docs/gui-compatibility.md)。

## 配置

所有键都是可选的；未设置时使用下表的 schema 默认值。在 profile 用户层覆盖 `working-activity` 行的配置。

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `phrases` | `boolean` | `true` | 俏皮文案池。`false` 渲染朴素功能标签；`mode: minimal` 会在未显式设置时关闭它。 |
| `publish` | `boolean` | `false` | 为会话日志重放型消费者追加只记日志的工作状态记录。DSH `0.2.x` 上是 ignorable 记录（`plugin:working-activity/status`），不影响 resume；旧走廊降级为 legacy `activity/status` 事件。第一方界面读取投影，不需要它。见[会话记录契约](#会话记录契约)。 |
| `tickMs` | `number` | `500` | 状态渲染 tick，单位 ms（100–5000，步长 50）。活跃相位按自身调度唤醒，并受该值上限约束。 |
| `publishIntervalMs` | `number` | `2000` | 状态行稳定时两次发布事件的最小间隔（500–30000，步长 500）。 |
| `detailLimit` | `number` | `40` | 路径、命令与模式等细节的最大展示长度（8–120）。 |
| `customActions` | `object` | `{}` | 工具名 → 动作文案池，大小写不敏感匹配。示例：`{"my_deploy": ["部署一下", "上线中"]}`。 |
| `narrate` | `boolean` | `true` | 向系统提示词注入 `⏵` 自述约定，并展示提取出的行。设为 `false` 则完全由事件推导。 |
| `lang` | `'auto' \| 'zh' \| 'en'` | `'auto'` | 文案语言。`auto` 的解析顺序：`DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → 操作系统 locale → `zh`。 |
| `frames` | `string` | `'moon8'` | 帧预设名。对 UI 消费者是信息性的；`dsh-tui` 自己解析持久化的帧选择。 |
| `mode` | `'lively' \| 'minimal'` | `'lively'` | `minimal` 只保留功能性信息（朴素标签，无俏皮文案池）。 |
| `features` | `object` | `{}` | 单特性开关；显式值优先于 `mode` 默认值。 |
| `customPhrases` | `string[]` | `[]` | 追加到基础思考文案池的额外短句。 |
| `showTokPerSec` | `boolean` | `false` | 流式输出时显示估算的 `~tok/s` 前缀。该值由增量文本推导，不是 provider 的 usage。 |
| `workRemindAt` | `number` | `0` | 累计工作达到该小时数后提示休息（0–24；`0` 关闭）。 |
| `debugLog` | `boolean` | `false` | 把每个不同渲染行的 JSON 追踪追加到 `~/.dsh-tui/working-activity-debug.log`（或 `DSH_WORKING_ACTIVITY_DEBUG_LOG` 指定的路径）。 |

`features` 接受且由 tracker 实际生效的特性开关：

`phrases`、`rareEggs`、`nightPhrases`、`weekend`、`holidays`、`combo`、`failPhrases`、`modelQuips`、`continuePhrases`。

## 投影契约

投影键是 `workingActivity`，在宿主组合了 `sessionProjections` 服务时注册；没有投影注册表的 profile 会直接跳过，不报错。

DSH `0.2.x` 的注册定义契约：

| 字段 | 含义 |
|---|---|
| `key` | `'workingActivity'` |
| `stateSchema` | 在持久化状态用于折叠之前校验它。 |
| `stateVersion` | 持久化缓存失效版本；快照形状或折叠语义变化时递增。 |
| `init(header, inheritedEventCount)` | 空日志的初始状态。 |
| `apply(state, event)` | 纯转换。对本单元不建模的事件返回**同一个引用**，宿主因此不做任何下游工作。 |
| `wire.viewSchema` | 客户端值离开宿主前进行校验。 |
| `wire.view(state)` | 渲染完整的客户端值。 |

同一个定义对象还携带旧注册表拼写——顶层 `schema`、`viewSchema`、`view` 以及零参数 `init`——因此一个对象无需运行时版本探测，就能注册到 `0.1.0-rc.6`、`0.1.2-alpha.2`、`0.1.7-rc.2` 与 `0.2.x` 的注册表。宿主提供 `stateOf(session, key)` 时，插件用它把只在实时阶段存在的事实（当前 `⏵` 自述与首 token 时刻）叠加到折叠值上；没有该接口的宿主回退到已结算消息携带的自述。

客户端值：

```ts
interface WorkingActivityView {
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string            // 宿主渲染出的整行文案
  live: boolean           // 活跃相位，其耗时文本应在客户端继续跳秒
  label?: string          // 当前工具动作或阶段标签
  detail?: string         // 路径 / 命令 / 模式片段
  phrase?: string         // 当前俏皮文案或 ⏵ 自述
  toolCount: number       // 本回合已完成的工具数
  phaseStartedAt: number  // 当前相位开始的 epoch 毫秒
  turnStartedAt: number   // 当前回合开始的 epoch 毫秒（idle 时为 0）
  updatedAt: number       // 最后一次折叠事件的时间戳
  lang: 'zh' | 'en'       // 渲染 line 时使用的语言
}
```

投影是事件驱动的，两次折叠之间 `line` 可能落后于墙钟。值里带有时间戳，客户端可以据此只重算那个会动的片段；Web 与 GUI 半边正是这样做的，片段形状无法识别时则回退到宿主原文。

客户端插件用 session 标准 kit 读取该值：

```ts
const activity = useProjection('workingActivity')
```

## 会话记录契约

`publish: true` 会追加只记日志的工作状态记录，供重放会话日志的消费者使用。该项**默认关闭**：第一方 TUI、Web UI 与 GUI 读取投影；只有重放型消费者才需要向共享日志追加。

**DSH `0.2.x`（`0.2.0-rc.2` / `0.2.1-rc.2`）。** 写入使用 `session.appendPluginRecord()`，记录类型为 `plugin:working-activity/status`。宿主会把该记录标记为 `ignorable: true`；无法识别的记录会被保留并跳过，因此不会让会话无法 resume。

**旧走廊（`0.1.0-rc.6` 至 `0.1.7-rc.2`）。** 这些宿主没有 `appendPluginRecord`，插件自动降级为通过 `session.append()` 追加 legacy `activity/status` 会话事件。该代事件没有 ignorable 标记，因此插件在加载时会把类型注册进所有可达的 `dsh-session` 副本——包括持久化校验器实际解析到的那份——以保持 resume 与持久化读取可用。注册是无条件且幂等的，也能读取更早 `publish: true` 配置写下的日志。若某个读取方解析到插件锚点无法触达的 `dsh-session` 副本，仍存在残余风险；第一方界面不需要开启发布。

两种拼写的载荷相同：

```ts
{
  phase: 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'
  line: string            // 纯文本状态行，无 ANSI
  label?: string          // 当前工作标签（工具动作 / 阶段）
  detail?: string         // 路径 / 命令 / 模式片段
  phrase?: string         // 当前俏皮文案
  toolCount: number       // 本回合已完成的工具数
  turnElapsedMs: number   // 距回合开始的毫秒数
  phaseStartedAt: number  // 相位开始的 epoch 毫秒（动画锚点）
}
```

两种拼写都不带 `surfaceOp`，都不会进入派生的模型历史。

发布规则：状态行变化立即发布；稳定行最多每 `publishIntervalMs` 重发一次，让长工具的已耗时保持实时而不刷爆日志。可选字段缺省时省略；载荷是无损 JSON。

可选的不变量伴生插件会同时校验两种拼写：legacy `activity/status` 事件与当前 `plugin:working-activity/status` 记录。

## 兼容性

node 半边支持下列宿主线。界面列表示该宿主线上可用的渲染通道；除最后一列注明的可选日志记录消费者外，传输始终是 `workingActivity` 投影。

| DSH 宿主线 | TUI（`dsh-tui`） | Web UI | 桌面 GUI | 验证 |
|---|---|---|---|---|
| `0.1.0-rc.6` | 兼容维护¹ | 不支持 | 不支持 | legacy 投影形状测试；运行时类型注册夹具 |
| `0.1.2-alpha.2` | 兼容维护¹ | 不支持 | 不支持 | `pnpm run test:alpha2`（已发布宿主图夹具） |
| `0.1.7-rc.2` | 支持 | 支持 | 不适用² | `pnpm run test:rc2`（已发布宿主图夹具） |
| `0.2.0-rc.2` | 支持 | 支持 | 支持³ | 主测试套件 + RC2 宿主夹具 + client bundle 门禁 + GUI 契约门禁 |
| `0.2.1-rc.2` | 支持 | 支持 | 支持³ | 主测试套件 + RC2 宿主夹具 + client bundle 门禁 + GUI 契约门禁 |

¹ 为兼容性维护，由隔离夹具 / 形状断言覆盖；主开发树不再针对该线编译。
² 桌面 GUI 使用 0.2.x 内核线，`0.1.7-rc.2` 不是 GUI 目标。
³ 桌面 GUI 复用 Web 客户端入口。GUI `0.22.4` 推荐 DSH `0.2.0-rc.2`，该版本在 peer 范围内。已验证的契约、证据与剩余限制见 `docs/gui-compatibility.md`。

说明：

- **TUI** 需要 `dsh-tui` 版本的 DSH 适配器支持同一条宿主线。当前 `dsh-tui` 线以 `0.2.x` 为主目标，自行维护活动行 / 投影消费，并以 `publish: false` 挂载本包。只有宿主组合了 `tuiPrompt` 时，插件才注册 `${activity}` prompt 值；当前 DSH 线不组合该服务。
- **Web UI** 需要 `0.1.7-rc.2`、`0.2.0-rc.2` 或 `0.2.1-rc.2` 客户端编队。浏览器 bundle 按 RC2 shell 的种子表构建（`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`-ui-slots`、`-ui-primitives`、`-ui-dockkit`）；`0.1.7-rc.2` shell 是它的子集，也能解析 bundle 唯一的 value import：`react/jsx-runtime`。
- **桌面 GUI** 复用 Web 入口：`platform: "web"`、同一个 dock 座位、同一份投影。插件运行在内核 Web 客户端里（当前线是 React 18.3.1），不在 GUI 宿主的 React 树中；peer 范围同时覆盖 18 / 19，避免 React 19 宿主把第二份 React 副本带进 bundle。GUI 必须提供 `react/jsx-runtime` 种子并组合上文三个 boot row。运行 `pnpm run verify:gui` 检查 GUI 契约（GUI 检出不存在时该门禁会跳过）。
- **旧日志消费者**（例如重放会话日志的终端 UI）可在任一支持的宿主线上设置 `publish: true`。在 `0.2.x` 上是 ignorable 插件记录；在旧线是 legacy `activity/status` 事件，由注册垫片兜底。

## 架构

```
src/
  index.ts                 插件入口：行配置、每会话 runtime、
                           TUI prompt 槽位、自述段、发布出口
  status.ts                纯 ActivityTracker 状态机与渲染器
  phrases.ts               双语文案池与选择逻辑
  frames.ts                帧预设（与 dsh-tui 共享）
  lang.ts                  语言解析与文案字典
  config.ts                文件式 working-activity 配置解析器
  projection.ts            workingActivity 会话投影（覆盖所有走廊）
  events.ts                activity/status 事件 + plugin-record 类型合并
  registration.ts          旧走廊的会话事件类型注册垫片
  invariant.ts             可选的 dsh-invariants 伴生插件
  compat/
    session-events.ts      持久 SessionEvent → ActivityEvent
    assistant-stream.ts    实时 agent/assistant-stream 帧 → ActivityEvent
    tool-result.ts         tool/result 的 call id 与失败读取
  client/
    index.ts               客户端入口：dock 注册
    WorkingLine.tsx        dock 组件
    elapsed.ts             本地耗时重算
    activity.ts            投影键的类型合并
    WorkingLine.module.css
cordis.patch.yml           自挂载 bundle patch
```

分层是刻意的：`status.ts`、`phrases.ts`、`frames.ts`、`lang.ts` 是纯逻辑且注入时钟；所有宿主形状猜测集中在 `src/compat/`；客户端半边只导入类型，不做领域折叠。

### 对模型的影响

- **工具：** 不注册任何工具。
- **surface 事件：** 默认不追加。发布的快照只记日志：`0.2.x` 上是 ignorable 插件记录，旧线是 legacy `activity/status` 事件。两者都无法到达模型。
- **提示词：** `narrate: true` 时注入一个固定系统提示词段（`⏵` 约定）。设 `narrate: false` 则对提示词零贡献。
- **每次请求 token：** 零；上述固定自述段除外。
- **KV 缓存：** 自述段按语言固定，不随回合变化。

## 开发

```sh
cd packages/activity/working-activity
pnpm install --frozen-lockfile
pnpm run build              # host tsc + client tsc，产物进 lib/types/
pnpm run build:client       # 浏览器 bundle，产物 lib/client.js
pnpm test                   # 单元 + Host 集成测试（vitest）
pnpm run verify:deps        # manifest 依赖门禁
pnpm run verify:lockfiles   # lockfile 一致性门禁
pnpm run verify:host-vocabulary
pnpm run verify:client-bundle
pnpm run verify:gui         # 桌面 GUI 契约（GUI 检出不存在时跳过）
pnpm run prepublishOnly     # 全部发布门禁
pnpm run test:alpha2        # 隔离的 0.1.2-alpha.2 宿主夹具
pnpm run test:rc2           # 隔离的 0.2.1-rc.2 宿主夹具
```

主开发图钉在 DSH `0.2.1-rc.2`（Cordis 4.0.5）。`test:alpha2` 与 `test:rc2` 各自携带独立锁文件与已发布宿主图，互斥的 peer 集合不会混装。父包重建后必须重装夹具（`pnpm run test:rc2` 已包含两步）。

客户端 bundle 是闭包工厂产物，经 `window.__ModuleLoader__.load({ id, factory })` 加载。无浏览器即可校验：loader 契约、模块说明符相对 RC2 种子表的纯度、声明的客户端行，以及 dock 注册与渲染分支。

## 故障排查

**TUI 里没有状态行。** 确认插件出现在组合后的 profile 中（`dsh --profile <profile> --dump-config`），并确认 `dsh-tui` 版本支持该宿主线。TUI 读取投影，`publish` 不影响它。

**Web UI 里没有状态行。** 确认已安装包包含 `lib/client.js`、profile 组合了三个 boot row、浏览器控制台没有 `MissingClientBundleError`。若是打包问题，运行 `pnpm run verify:client-bundle`。

**工具数一直是 0，状态行卡在第一个工具上。** 这是 `0.1.7-rc.2` 之前的 `tool/result` 关联断裂。升级到当前发布版；修复后的代码从 `message.source.callId` / `message.toolCallId` 读取 call id，从 `message.isError` 读取失败标记。

**开启 `publish` 后会话无法 resume。** 在 DSH `0.2.0-rc.2` / `0.2.1-rc.2` 上，发布的快照是 ignorable 插件记录，不会阻塞 resume。旧走廊会尝试把所有可达的 `dsh-session` 副本都注册上 legacy 类型；若读取方解析到插件无法触达的副本，请关闭 `publish`。第一方界面不需要它。

**不变量伴生插件没有运行。** bundle patch 只挂载 `working-activity` 行。请在 profile 用户层显式插入注册表与伴生行：

```yaml
- insert:
    - id: invariants
      name: '@deepseek-ai/dsh-invariants'
    - id: working-activity-invariant
      name: 'dsh-working-activity/invariant'
```

若组合中已经挂载了 `invariants` 注册表，跳过该行。

**文案语言不对。** 在行上设置 `lang: zh` 或 `lang: en`，或控制共享链（`DSH_TUI_LANG`、`~/.dsh-tui/lang.json`、操作系统 locale）。解析出的语言也会随投影下发，客户端据此用同一语言重算耗时。

**状态行文案不符合预期。** 设置 `debugLog: true`；每个不同的渲染行都会以 JSON 追加到 `~/.dsh-tui/working-activity-debug.log`，包含推导输入（相位、文案池、槽位）。可用 `DSH_WORKING_ACTIVITY_DEBUG_LOG` 重定向追踪文件。

## 隐私与安全

插件不采集数据、不发起网络请求、没有遥测。状态值全部由会话流在本地推导。开启 `publish: true` 时，快照只写入本地会话日志——`0.2.x` 上是 ignorable 插件记录，旧线是只记日志的 `activity/status` 事件——永不进入模型历史。`customActions`、文案池与语言偏好只保存在本地配置中。

## 许可证

BSD-3-Clause，见 [`LICENSE`](LICENSE)。

仓库根目录的 `pi-working-activity` 扩展是独立包，使用 MIT 许可证；见[仓库 README](../../../README.md)。
