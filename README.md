# working-activity

面向编码 agent 的实时工作状态行。同一套设计维护两个平台适配，分别以独立 npm 包发布：

| 平台 | npm 包 | 源码 | 安装 |
|---|---|---|---|
| pi CLI | `pi-working-activity` | [`extensions/index.ts`](extensions/index.ts) | `pi install npm:pi-working-activity` |
| DeepSeek Harness（DSH） | `dsh-working-activity` | [`packages/activity/working-activity/`](packages/activity/working-activity/) | `dsh plugin --profile <profile> add dsh-working-activity` |

作者：chimney（[@ccch1mneyyy](https://github.com/ccch1mneyyy)）。社区项目，非 DeepSeek 官方项目。

两个版本共享同一套状态行理念——实时工具活动、耗时、模型自述与收尾统计——但运行时、配置与安装方式各自独立。pi 版是无构建的 pi 扩展；DSH 版是 cordis 宿主插件，另带一个可选的 Web 客户端条目，覆盖 TUI、Web UI 与桌面 GUI 三个界面。

## 目录结构

```
extensions/                              pi 版扩展（唯一源码，无构建）
tests/                                   pi 版测试
package.json                             pi 版包（发布 pi-working-activity）
packages/activity/working-activity/      DSH 版插件（发布 dsh-working-activity）
packages/activity/working-activity-alpha2-compat/
                                         隔离的 DSH 0.1.2-alpha.2 兼容夹具
packages/activity/working-activity-rc2-compat/
                                         隔离的 DSH 0.2.1-rc.2 兼容夹具（peer 覆盖 0.2.0-rc.2）
patches/webui-working-activity.patch      历史 Web runtime 补丁（保留仅作历史参考，当前构建不使用）
docs/dsh-working-activity.md             DSH 版完整文档
docs/host-shape-audit-0.1.7-rc.2.md      DSH 0.1.7-rc.2 宿主形状审计（历史基线，含 0.2.x 附注）
docs/gui-compatibility.md               桌面 GUI 兼容性核查
```

## 快速开始

pi：

```sh
pi install npm:pi-working-activity
```

DSH：

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

DSH 包是自挂载 bundle，安装后无需手动挂载。TUI、Web UI 与 GUI 读取 `workingActivity` 会话投影；Web 端不再需要 runtime 补丁。

---

# pi 版

pi 版是 `pi-working-activity` 扩展的源码，直接由 pi 加载 TypeScript，无构建步骤。配置写入 `~/.pi/agent/working-activity.json`，首次运行自动生成。

## 功能

### 实时工具活动

监听 `tool_execution_start` / `tool_execution_end`，Working 行显示当前真正在跑的工具：

```
翻翻 src/index.ts
改改 package.json
跑命令 npm run build
搜搜 NARRATE_MIN_MS
```

### 工具进度

监听 `tool_execution_update`，优先读取工具返回的百分比、阶段和状态；对 bash 等流式输出，识别常见的下载、构建、测试与部署进度：

```
拉取模型权重 · 42% · 8s
跑命令 npm test · Testing integration · 12s
部署一下 staging · Deploying assets · 31s
```

普通输出不会直接进入 Working 行，只展示结构化进度、百分比和可识别阶段。

### 快工具队列

执行时间不足 1.5 秒的工具不会被跳过：快工具排队逐个播报约 1 秒，最后一条粘留约 3 秒。

### 思考文案池

思考时轮换 95 条口语化短句，约 2.6 秒一换：

```
嗯…让我捋捋 → 盘一下盘一下 → 大脑转起来了 → 思考.gif → 啾，让我想想 → lol → 别催别催
```

长时间思考自动分档：

- 30 秒：`转圈圈…`、`马上马上`、`嗯，让我细想想`
- 1 分钟：`还在努力…`、`烧脑中…`、`这题有点东西`
- 5 分钟：`还没放弃…`、`这题真的硬…`、`我给跪了…`

### 稀有彩蛋

约 1/150 概率（平均 6–7 分钟一次）显示炫彩流光文案，停留 7.5 秒：

```
✦ S S R ！ ✦   ✧ 金色传说 ✧   ✶ 你发现我了 ✶
```

四层效果叠加：平滑色相梯度慢滚、亮度波浪呼吸、带下划线的高光从左扫到右、两侧金边花饰轮转。

### 模型自述

默认开启。扩展通过 `before_agent_start` 向模型注入约定：每个步骤开始时写 `⏵ 你在做什么（≤20 字）`。扩展实时解析流式输出，把自述显示在 Working 行。可在配置中设 `"narrate": false` 或执行 `/activity narrate off` 关闭。

```
⏵ 查一下报错原因        →  Working 行：查一下报错原因 · 搜搜 error.log
⏵ 给补丁跑个验证        →  Working 行：给补丁跑个验证 · 跑命令 node test
```

### 配速与收尾摘要

- 思考中：`嗯… · 总1m23s`
- 工具中：`改改 file.ts · 3s`
- 结束后：底部状态区显示 `搞定 ✓ · 4 工具 · 想3s 干2s`，对话区末尾通知 `⏱ 总用时 1m23s · 4 工具 · 想12s 干11s`

### 上下文预警

每 3 秒检查一次 context 用量，超过阈值（默认 80%）时 Working 行变黄：

```
⚠ 上下文85% · 嗯… · 总1m23s
```

`contextWarnAt: 0` 关闭。

### 连击与慢工具

- 连续 5 个以上工具触发 `火力全开×N`（并行工具计入连击）；10 个以上在收尾时显示 `十连击`。
- 单个工具超过 30 秒时加 `这个有点慢 ·` 前缀。

### 工具剩余时间

工具回报进度百分比时，按已耗时与完成比例推算剩余时间（支持 `percent` / `percentage` / `progressPercent` / `current/total`）：

```
拉取模型权重 · 42% · 还剩~11s
```

没有百分比进度的工具不显示剩余时间，不影响其他信息。

### git 分支上下文

检测到 git 操作（`git` / `gh` 等工具名，或 bash 类命令里含 `git `）时显示当前分支，缓存 20 秒、异步获取、不阻塞渲染：

```
拉代码 · main · 3s
```

非 git 仓库自动隐藏。

### 时间感知

- 本地时间 0–6 点：思考池混入 `修仙中…`、`夜猫子出没`、`熬夜冠军` 等深夜文案。
- 周末：首次会话显示一句 `周末也在卷？` 或 `放假也陪你`。

### 动画预设

`/activity` 打开交互选择器，或 `/activity frames <name>` 直接切换。内置 28 个预设，包括：

`claude` `braille` `moon` `moon8` `comet` `spark` `breathe` `dots` `circle` `star2` `flip` `aesthetic` `hamburger` `whale-spout` `whale-spin` `whale-bubbles` `clock` `traffic_lights` `random` 等。

### 英文冷幽默

`lol` `hm` `oh` `ok` `um` `heh` `uh` `nah` `mm` `wow` `nice` `rgrg` `done` `again` `gg` `ez` 会穿插在中文文案中。

### 失败文案

工具出错时不再只显示 `✗`，而是随机显示一句失败文案：

```
翻车了 · 读文件 config.json ✗
权限不对？ · 跑命令 npm i ✗
```

### 子代理计数

并行多个子代理时显示 `小弟×N`：

```
派个小弟 修测试 · 小弟×3 · 另 2 项
```

### 流式速率

`showTokPerSec: true` 后，按 `text_delta` 的中英文字符粗估流式 token 速率：

```
~42 tok/s · 嗯… · 总1m23s
```

pi 的流式事件不提供逐段 usage，因此这是实时估算值；收尾摘要中的 token 数仍使用模型返回的实际 usage。

### 节假日彩蛋

自动检测元旦、春节、情人节、愚人节、劳动节、儿童节、万圣节、平安夜、圣诞与跨年，思考池混入节日文案，并使用七彩流光渲染。

### 模型切换梗

`/model` 切换模型时，Working 行显示一句与模型名相关的文案，1.5 秒后恢复。

### 累计活跃提醒

默认每累计活跃 3 小时提醒一次休息。只有 agent 真正运行的时间计入；`workRemindAt: 0` 关闭，或改成其他小时数。

### 成本与 token 核算

每轮结束（≥3 秒）时在通知中追加本轮成本与 token 总量，读取 pi 官方核算的 `usage.cost.total`：

```
⏱ 总用时 2m12s · 15 工具 · 想 123s 干 6s · 💰 $0.087 · 🔥 34.2k tok
```

`/activity stats` 查看分项：本轮 / 会话累计花费、缓存命中率、思考 token。

| 字段 | 来源 |
|---|---|
| 成本 | pi 官方 `usage.cost.total`（含缓存折扣、阶梯价） |
| token | input + output + cacheRead + cacheWrite |
| 缓存命中 | cacheRead / (input + cacheRead) |
| 思考 | reasoning token（output 的子集，不重复计费） |

### 上下文压缩感知

监听 `session_compact` 事件，上下文被压缩时显示通知，与上下文预警形成完整闭环：

```
🗜️ 上下文已压缩 · 45.0k→12.0k tok · 腾出 73%
🗜️ 溢出自动压缩 · 45.0k→12.0k tok · 腾出 73% · 将重试
```

压缩调用的成本也会累计到本轮 / 会话统计。

### 自定义工具映射

`customActions` 按工具名精确匹配，为自己的工具 / MCP 定义文案（配置中的值不会当正则执行）：

```json
{
  "customActions": {
    "my_deploy": ["部署一下", "上线中"],
    "format_code": ["格式化", "整理代码"]
  }
}
```

### 交互设置面板

`/activity settings` 打开可搜索的设置面板，统一调整模式、动画、自述、速率、上下文阈值、活跃提醒和全部特性开关。面板顶部使用当前主题实时播放动画与文案预览；每次切换立即持久化。

### 内置 Doctor

`/activity doctor` 检查：

- 配置 JSON 是否可解析、阈值关系是否有效；
- 当前预设与全部动画结构是否完整；
- 特性键是否认识；
- 当前主题能否提取 RGB accent；
- 配置目录与文件是否真正可读写。

### 双模式与特性开关

```
/activity mode minimal   →  只显示真实工具 + 计时 + 预警
/activity mode lively    →  全套俏皮文案 + 彩蛋（默认）
```

单特性独立开关（覆盖模式默认）：

```
/activity feature              →  列出所有特性状态
/activity feature rareEggs off →  只关彩虹彩蛋
/activity feature shimmer auto →  恢复跟随模式
```

可开关特性：`phrases`（俏皮文案）`rareEggs`（彩虹彩蛋）`nightPhrases`（深夜文案）`weekend`（周末问候）`holidays`（节假日）`combo`（连击）`failPhrases`（失败文案）`modelQuips`（模型梗）`shimmer`（星辉扫过）`continuePhrases`（打断接梗）

## 安装

```sh
pi install npm:pi-working-activity
```

## 配置

配置文件：`~/.pi/agent/working-activity.json`（首次运行自动生成）。

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `frames` | `string` | `"moon"` | 动画预设名，`"random"` 每轮随机 |
| `narrate` | `boolean` | `true` | `⏵` 模型自述开关（显式 `false` 关闭） |
| `contextWarnAt` | `number` | `80` | 上下文预警阈值（百分比），`0` 关闭 |
| `contextDangerAt` | `number` | `95` | 上下文危险阈值，超过后变红 |
| `showTokPerSec` | `boolean` | `false` | 流式输出时显示 `~tok/s` 估算速率 |
| `workRemindAt` | `number` | `3` | 累计活跃 N 小时提醒休息，`0` 关闭 |
| `customPhrases` | `string[]` | `[]` | 追加到思考文案池的自定义短句 |
| `customActions` | `object` | — | 自定义工具 → 文案映射，如 `{"my_tool": ["搞一下","整一个"]}` |
| `debugLog` | `boolean` | `false` | 调试日志（`~/.pi/agent/working-activity-debug.log`，超过 512KB 自动截断） |
| `mode` | `string` | `"lively"` | `"minimal"` 只保留功能性信息 |
| `features` | `object` | — | 单特性开关，如 `{"rareEggs": false}`，覆盖 mode 默认 |

## 命令

| 命令 | 说明 |
|---|---|
| `/activity settings` | 打开可搜索设置面板，实时预览动画与文案 |
| `/activity doctor` | 检查配置、主题、预设和持久化权限 |
| `/activity` | 打开动画预设交互选择器 |
| `/activity frames <name>` | 直接切换预设，如 `/activity frames claude` |
| `/activity frames random` | 每轮随机一个预设 |
| `/activity narrate on\|off` | 开关模型自述 |
| `/activity mode lively\|minimal` | 总开关：花哨 / 极简 |
| `/activity feature` | 列出所有特性开关状态 |
| `/activity feature <名> on\|off\|auto` | 单特性开关，auto 恢复跟随模式 |
| `/activity status` | 显示当前所有配置 |
| `/activity warn <0-100>` | 修改上下文预警阈值，0 = 关闭 |
| `/activity danger <n>` | 修改红色危险阈值，必须不低于 warn 阈值 |
| `/activity tps on\|off` | 开关流式 `~tok/s` 估算显示 |
| `/activity remind <0-24>` | 设置累计活跃提醒间隔，0 = 关闭 |
| `/activity phrase add <文案>` | 追加自定义思考短语 |
| `/activity phrase list` | 列出所有自定义短语 |
| `/activity stats` | 本轮 + 会话统计：工具数、想/干比、成本、token、缓存命中、思考 token |
| `/activity config export` | 导出当前配置 JSON 到当前目录 `working-activity.export.json` |
| `/activity config import <路径>` | 从文件导入配置并立即生效（自动校验） |

## 模型自述原理

1. 扩展通过 `before_agent_start` 把约定追加到该轮 system prompt：「每一步写 `⏵ 你正在做的事（≤20 字）`」。
2. 模型在流式输出中写下 `⏵ 查一下报错原因`。
3. 扩展实时解析 `text_delta`，提取最新 `⏵` 行显示在 Working 行。
4. 每个 LLM turn 重置等待态；自述最低展示 2 秒，流式活跃时不消失，安静 5 秒后退回普通文案。

## 文案风格

- 中文：短、口语、俏皮，不说教不摆谱。
- 英文：面无表情的冷幽默，穿插在中文文案中制造反差。
- 游戏梗（SSR、金色传说、gg、ez）只放在稀有彩蛋池（1/150 爆率），不影响日常使用。

## 开发

```sh
npm run check       # 语法/类型检查（npm run typecheck 的别名）
npm run typecheck   # TypeScript 类型检查
npm test            # 测试
```

pi 版没有构建步骤，`extensions/index.ts` 即发布源码。

---

# DSH 版

DSH 版是 DeepSeek Harness 的 cordis 宿主插件，包名 `dsh-working-activity`。它把会话的持久事件流与实时模型输出折叠成一条工作状态行，经 `workingActivity` 会话投影提供给 TUI、Web UI 与桌面 GUI。浏览器与桌面端不写会话日志。

完整文档见：

- 插件包 README：[英文](packages/activity/working-activity/README.md) / [中文](packages/activity/working-activity/README.zh.md)
- [DSH 版完整文档](docs/dsh-working-activity.md)（安装、挂载机制、配置、Web UI 契约、已知限制）
- [0.1.7-rc.2 宿主形状审计](docs/host-shape-audit-0.1.7-rc.2.md)（历史基线，含 0.2.x RC2 附注）
- [GUI 兼容性](docs/gui-compatibility.md)

## 功能概览

- **状态行**：`waiting` → `thinking` → `tool` → `done` 四相位，思考文案轮换、长思考分档、深夜 / 周末 / 节假日文案、稀有彩蛋、工具连击、模型切换梗与失败文案。
- **工具活动**：运行中工具显示动词 + 参数细节 + 已耗时；`tool/result` 按精确 call id 配对，失败工具带 `✗` 与失败文案。
- **收尾摘要**：`搞定 ✓ · N 工具 · 想Xs 干Ys`，短暂钉住最后一个工具片段。
- **模型自述**：`narrate: true` 时注入 `⏵` 约定并实时展示。
- **双语文案**：中 / 英两套池，`lang: auto | zh | en`，跟随 dsh-tui 的语言链。
- **紧凑 HUD**：`ctx 62%`（阈值告警）、`2/5 待办`、后台任务、子代理 / Agent Team、目标、计划、排队输入与收尾 token；逐项可关，宿主缺少的信号不显示。
- **无侵入**：不注册工具、不追加 surface 事件、不进入模型历史。

## 安装

```sh
dsh plugin --profile <profile> add dsh-working-activity
```

本包是自挂载 bundle：`dsh plugin` 安装后，CLI 的 reconcile 步骤把它追加进 profile 的 `dsh.profile.bundles`，启动时 `cordis.patch.yml` 把 `working-activity` 行插入组合树。调整配置时，在 profile 用户层按 id 覆盖，不要插入第二个同 id 行：

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
```

TUI 场景请直接安装 `dsh-tui`：本包作为它的依赖自动挂载，不要再向同一个 profile 单独 add 本包。

## 三个界面

| 界面 | 传输 | 说明 |
|---|---|---|
| TUI（`dsh-tui`） | `workingActivity` 投影 | dsh-tui 通过 `@deepseek-harness-tui/dsh-tui/working-activity` 挂载本包，固定 `publish: false`，在状态行渲染投影值；同时复用本包的 `./frames` 与 `./config`。 |
| Web UI | `workingActivity` 投影 | 客户端 bundle 在 `conversation.input.dock` 注册一行状态（id `activity`，order `15`）；`useProjection('workingActivity')` 读取。空闲 / 首个值之前不渲染，活跃相位在客户端本地重算耗时。 |
| 桌面 GUI | `workingActivity` 投影 | 与 Web UI 共用 `platform: "web"` 客户端入口、dock 座位与 `useProjection`；插件运行在内核 Web 客户端，peer 同时覆盖 React 18 / 19。 |

Web 端不再需要 `dsh-client-runtime` 补丁：`activity/status` 事件搬运方案已退役，投影是唯一通道。`publish: true` 仅用于重放会话日志的消费者：`0.2.x` 上写入 ignorable 的 `plugin:working-activity/status` 记录，不会影响 resume；旧线降级为 legacy `activity/status` 事件，由类型注册垫片兜底。

## 兼容性

| DSH 宿主线 | TUI | Web UI | 桌面 GUI | 验证 |
|---|---|---|---|---|
| `0.1.0-rc.6` | 兼容维护 | 不支持 | 不支持 | legacy 投影形状测试、类型注册夹具 |
| `0.1.2-alpha.2` | 兼容维护 | 不支持 | 不支持 | `pnpm run test:alpha2` |
| `0.1.7-rc.2` | 支持 | 支持 | 不适用 | `pnpm run test:rc2` |
| `0.2.0-rc.2` | 支持 | 支持 | 支持（GUI 0.22.4 推荐内核） | 主测试套件、RC2 宿主夹具、client bundle 门禁、GUI 契约门禁 |
| `0.2.1-rc.2` | 支持 | 支持 | 支持 | 主测试套件、RC2 宿主夹具、client bundle 门禁、GUI 契约门禁 |

说明：TUI 支持取决于 `dsh-tui` 版本的 DSH 适配器；当前 `dsh-tui` 线以 `0.2.x` 为主目标并向下兼容到 `0.1.0-rc.6`。Web UI 需要 `0.1.7-rc.2`、`0.2.0-rc.2` 或 `0.2.1-rc.2` 客户端编队。GUI 复用 Web 入口，详见 `docs/gui-compatibility.md`。HUD 信号按日志能力出现：`request/context`、`todo/write`、`goal/change`、`plan/mode`、`team/*`、`subagent/catalog` 在 0.1.2-alpha.2 已有；`job/*` 与 `agent/inbox/spliced` 在 0.1.7+ 线出现（0.1.2-alpha.2 没有）。

## 配置

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `phrases` | `boolean` | `true` | 俏皮文案池；`false` 渲染朴素标签 |
| `publish` | `boolean` | `false` | 为日志重放消费者追加工作状态记录：`0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录（不影响 resume），旧线降级为 legacy `activity/status` 事件；第一方界面读取投影，不需要它 |
| `tickMs` | `number` | `500` | 状态渲染 tick（100–5000） |
| `publishIntervalMs` | `number` | `2000` | 稳定行最小发布间隔（500–30000） |
| `detailLimit` | `number` | `40` | 细节最大展示长度（8–120） |
| `customActions` | `object` | `{}` | 工具名 → 动作文案池 |
| `narrate` | `boolean` | `true` | `⏵` 自述约定开关 |
| `lang` | `'auto' \| 'zh' \| 'en'` | `'auto'` | 文案语言 |
| `frames` | `string` | `'moon8'` | 帧预设名（供 UI 消费者读取） |
| `mode` | `'lively' \| 'minimal'` | `'lively'` | 花哨 / 极简 |
| `features` | `object` | `{}` | 单特性开关 |
| `customPhrases` | `string[]` | `[]` | 追加思考短语 |
| `showTokPerSec` | `boolean` | `false` | 流式 `~tok/s` 估算 |
| `workRemindAt` | `number` | `0` | 累计活跃 N 小时提醒休息，0 关闭 |
| `hud` | `boolean` | `true` | 紧凑 HUD 总开关 |
| `contextWarnAt` | `number` | `80` | 上下文警告阈值（%） |
| `contextDangerAt` | `number` | `95` | 上下文危险阈值（%） |
| `debugLog` | `boolean` | `false` | 渲染行 JSON 追踪日志 |

完整配置说明、投影契约与会话记录契约见[插件包 README](packages/activity/working-activity/README.md)。

## 开发

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
pnpm run test:alpha2        # 0.1.2-alpha.2 兼容夹具
pnpm run test:rc2           # 0.2.1-rc.2 兼容夹具
```

主开发图钉在 DSH `0.2.1-rc.2`（Cordis 4.0.5）。兼容夹具各自携带独立锁文件与已发布宿主图，避免互斥 peer 集合混装。

## 已知限制

- 单一状态行：每个会话一条，界面显示最近活跃会话。
- 无进度百分比：DSH 没有工具进度事件，长工具只显示已耗时。
- Web / GUI 的秒数由客户端本地重算；服务端投影只在已提交事件折叠时变化。
- 不变量伴生插件需要显式插入注册表与伴生行，bundle patch 只挂载主行。

---

## 隐私与安全

两个版本都不采集、不上传任何数据，无网络请求、无遥测。pi 版配置与文案只存在本地；DSH 版默认只把状态保留在宿主内存中的 `workingActivity` 投影里；`publish: true` 时写入本地会话日志：`0.2.x` 上是 ignorable 的 `plugin:working-activity/status` 记录，旧线是只记日志的 `activity/status` 事件，模型均不可见，回放忽略。

## License

根仓库文档与 pi 版：MIT。DSH 插件包（`packages/activity/working-activity/`）：BSD-3-Clause，见其 [`package.json`](packages/activity/working-activity/package.json) 与 [`LICENSE`](packages/activity/working-activity/LICENSE)。
