# working-activity

> 让 agent 的"工作状态行"活过来——实时工具动态与进度、俏皮文案、模型自述、上下文预警。同一套想法,适配两个平台:**pi CLI** 与 **DeepSeek Harness(DSH)**。

作者:chimney([@ccch1mneyyy](https://github.com/ccch1mneyyy))。社区出品,非官方项目。

> 本仓库由 `pi-working-activity`(主仓库,保留全部历史)与 `dsh-working-activity`(已归档)合并而来;两个 npm 包继续独立发布,各自的安装方式不变。

## 平台一览

| 平台 | npm 包 | 源码位置 | 安装 |
|---|---|---|---|
| pi CLI | `pi-working-activity` | [`extensions/`](extensions/index.ts) | `pi install npm:pi-working-activity` |
| DeepSeek Harness | `dsh-working-activity` | [`packages/activity/working-activity/`](packages/activity/working-activity/) | `dsh plugin --profile <profile> add dsh-working-activity` |

## 目录结构

```
extensions/                             pi 版扩展(唯一源码,无构建)
tests/                                  pi 版测试
package.json                            pi 版包(发布 pi-working-activity)
packages/activity/working-activity/     DSH 版插件(发布 dsh-working-activity)
patches/webui-working-activity.patch    DSH Web UI runtime 补丁
docs/dsh-working-activity.md            DSH 版完整文档(原 dsh 仓库 README)
```

---

# pi 版

> 让 pi 的 Working 行活过来——实时工具动态与进度 + 俏皮中文文案 + 稀有彩虹彩蛋 + 模型自述 + 上下文预警。

## 功能一览

### 🛠 真实工具活动
监听 `tool_execution_start` / `tool_execution_end`，Working 行实时显示正在跑什么——不是假转圈。

```
翻翻 src/index.ts
改改 package.json
跑命令 npm run build
搜搜 NARRATE_MIN_MS
```

### 📈 实时工具进度
监听 `tool_execution_update`，优先读取工具返回的百分比、阶段和状态；对 bash 等流式输出，也会识别常见的下载、构建、测试和部署进度。

```
拉取模型权重 · 42% · 8s
跑命令 npm test · Testing integration · 12s
部署一下 staging · Deploying assets · 31s
```

普通输出不会直接塞进 Working 行，只有结构化进度、百分比和可识别阶段会展示。

### ⏩ 快工具队列重播
执行时间 < 1.5s 的工具一闪而过？不会。快工具排队逐个播 1s，最后一条粘留 3s，让你看得到。

### 💬 俏皮文案池
思考时 Working 行轮换 95 条口语化短句，约 2.6s 一换，像活人在说话。

> 嗯…让我捋捋 → 盘一下盘一下 → 大脑转起来了 → 思考.gif → 啾，让我想想 → lol → 别催别催

想太久了自动换档：
- 🕐 **30s**：转圈圈… 马上马上 嗯，让我细想想
- 🕑 **1min**：还在努力… 烧脑中… 这题有点东西
- 🕒 **5min**：还没放弃… 这题真的硬… 我给跪了…

### 🎰 稀有彩虹彩蛋
约 1/150 概率（每 6–7 分钟一次），Working 行炸出炫彩流光，停留 7.5 秒。

```
✦ S S R ！ ✦   ✧ 金色传说 ✧   ✶ 你发现我了 ✶
```

四层特效叠加：平滑色相梯度慢滚 + 亮度波浪呼吸 + 一道带下划线的高光从左扫到右 + 两侧金边花饰轮转。比 1.0 的均匀彩虹有质感得多。

### ⏵ 模型自述
默认开启。扩展通过 `context` 事件向模型注入一条约定：每个步骤开始时写 `⏵ 你在做什么（≤20 字）`。扩展实时解析流式输出，把自述显示在 Working 行。不需要可在配置里设 `"narrate": false` 或 `/activity narrate off`。

```
⏵ 查一下报错原因        →  Working 行：查一下报错原因 · 搜搜 error.log
⏵ 给补丁跑个验证        →  Working 行：给补丁跑个验证 · 跑命令 node test
```

### 📊 实时配速
- 思考中：`嗯… · 总1m23s`
- 工具中：`改改 file.ts · 3s`
- 结束后：底部状态区闪现 `搞定 ✓ · 4 工具 · 想3s 干2s`，同时对话区末尾弹通知 `⏱ 总用时 1m23s · 4 工具 · 想12s 干11s`

### ⚠ 上下文预警
每 3s 检查一次 context 用量。超过阈值（默认 80%）时 Working 行亮黄：

```
⚠ 上下文85% · 嗯… · 总1m23s
```

`contextWarnAt: 0` 关闭。

### 🔥 连击检测
连续 5+ 工具触发 `火力全开×N`（并行工具也算连击）。10+ 工具收尾时显示 `十连击`。

### ⏱ 慢工具提示
单工具超 30s 亮 `这个有点慢 ·` 前缀。

### ⏳ 工具剩余时间
工具回报进度百分比时，按已耗时和完成比例推算剩余时间（支持 `percent` / `percentage` / `progressPercent` / `current/total`）：

```
拉取模型权重 · 42% · 还剩~11s
```

没有百分比进度的工具不显示，不影响其他信息。

### 🌿 git 分支上下文
检测到 git 操作（`git`/`gh` 等工具名，或 bash 类命令里带 `git `）时，Working 行显示当前分支（缓存 20s，异步获取不阻塞）：

```
拉代码 · main · 3s
```

非 git 仓库自动隐藏。

### 🌙 时间感知
- **0–6 点**：思考池混入 `修仙中…` `夜猫子出没` `熬夜冠军` 等深夜专属文案
- **周末**：首次会话弹一句 `周末也在卷？` `放假也陪你`

### 🎨 28 个动画预设
`/activity` 打开交互选择器，或 `/activity frames <name>` 直接切：

`claude` `braille` `moon` `comet` `spark` `breathe` `dots` `circle` `star2` `flip` `aesthetic` `hamburger` `random` …

### 😐 英文冷幽默
`lol` `hm` `oh` `ok` `um` `heh` `uh` `nah` `mm` `wow` `nice` `rgrg` `done` `again` `gg` `ez`

混在一堆「嗯…」「盘一下」「啾」中间，冷不丁冒一句面无表情的英语。那种「我也不是真的在笑」的冷感。

### ❌ 工具失败文案
出错的工具不再只是 `✗`，而是随机一句：

```
翻车了 · 读文件 config.json ✗
权限不对？ · 跑命令 npm i ✗
```

### 🤖 子代理计数
并行多个子代理时显示 `小弟×N`：

```
派个小弟 修测试 · 小弟×3 · 另 2 项
```

### ⚡ ~tok/s 流式速率
`showTokPerSec: true` 后，按 `text_delta` 的中英文字符粗估流式 token 速率：

```
~42 tok/s · 嗯… · 总1m23s
```

Pi 的流式事件不提供逐段 usage，因此这是实时估算值；收尾摘要里的 token 数仍使用模型返回的实际 usage。

### 🎄 节假日彩蛋
元旦、春节、情人节、愚人节、劳动节、儿童节、万圣节、平安夜、圣诞、跨年——自动检测，思考池混入节日专属文案，同样用七彩流光渲染。

### 🔄 模型切换梗
`/model` 切模型时，Working 行闪一句和模型名相关的梗，1.5s 后恢复。

### ☕ 累计活跃提醒
默认每累计活跃 3 小时弹一次提示，提醒喝水休息。只有 agent 真正运行的时间计入；`workRemindAt: 0` 关闭，或改成其他间隔（小时数）。

### 💰 成本与 token 核算
每轮结束时（≥3s）在通知里追加本轮成本和 token 总量，直接读 Pi 官方核算的 `usage.cost.total`——和你的账单一致，不是估算。

```
⏱ 总用时 2m12s · 15 工具 · 想 123s 干 6s · 💰 $0.087 · 🔥 34.2k tok
```

`/activity stats` 查看更详细的分项：本轮 / 会话累计花费、缓存命中率、思考 token。

| 字段 | 来源 |
|------|------|
| 💰 成本 | Pi 官方 `usage.cost.total`（含缓存折扣、阶梯价） |
| 🔥 token | input + output + cacheRead + cacheWrite |
| 缓存命中 | cacheRead / (input + cacheRead) |
| 🧠 思考 | reasoning token（output 的子集，不重复计费） |

### 🗜️ 上下文压缩感知
监听 `session_compact` 事件，上下文被压缩时闪现一条通知——和上下文预警形成完整闭环：警告 → 压缩 → 恢复。

```
🗜️ 上下文已压缩 · 45.0k→12.0k tok · 腾出 73%
🗜️ 溢出自动压缩 · 45.0k→12.0k tok · 腾出 73% · 将重试
```

压缩调用的成本也会自动累计到本轮/会话统计。

### 🔧 自定义工具映射
`customActions` 让你为自己的工具/MCP 定义文案映射，按工具名精确匹配（不执行配置中的正则）：

```json
{
  "customActions": {
    "my_deploy": ["部署一下", "上线中"],
    "format_code": ["格式化", "整理代码"]
  }
}
```

### ⚙ 交互设置面板
`/activity settings` 打开可搜索的设置面板，统一调整模式、动画、自述、速率、上下文阈值、活跃提醒和全部特性开关。

面板顶部会使用当前主题实时播放动画和文案预览；每次切换立即持久化，不需要退出面板。

### 🩺 内置 Doctor
`/activity doctor` 一次检查：

- 配置 JSON 是否可解析、阈值关系是否有效
- 当前预设和全部动画结构是否完整
- 特性键是否认识
- 当前主题能否提取 RGB accent
- 配置目录与文件是否真正可读写

### 🎭 双模式 + 特性开关
花埑功能全部可选。总开关一键切换：

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

```bash
pi install npm:pi-working-activity
```

## 配置

`~/.pi/agent/working-activity.json`（首次运行自动生成）：

| 键 | 类型 | 默认值 | 说明 |
|---|------|--------|------|
| `frames` | `string` | `"moon"` | 动画预设名，`"random"` 每轮随机 |
| `narrate` | `boolean` | `true` | ⏵ 模型自述开关（默认开，显式 `false` 关闭） |
| `contextWarnAt` | `number` | `80` | 上下文预警阈值（百分比），`0` 关闭 |
| `contextDangerAt` | `number` | `95` | 上下文危险阈值，超过后变红 |
| `showTokPerSec` | `boolean` | `false` | 流式输出时显示 `~tok/s` 估算速率 |
| `workRemindAt` | `number` | `3` | 累计活跃 N 小时提醒喝水，`0` 关闭 |
| `customPhrases` | `string[]` | `[]` | 追加到思考文案池的自定义短句 |
| `customActions` | `object` | — | 自定义工具→文案映射，如 `{"my_tool": ["搞一下","整一个"]}` |
| `debugLog` | `boolean` | `false` | 调试日志（`~/.pi/agent/working-activity-debug.log`，>512KB 自动截断） |
| `mode` | `string` | `"lively"` | `"minimal"` 只保留功能性信息 |
| `features` | `object` | — | 单特性开关，如 `{"rareEggs": false}`，覆盖 mode 默认 |

## 命令

| 命令 | 说明 |
|------|------|
| `/activity settings` | 打开可搜索设置面板，实时预览动画和文案 |
| `/activity doctor` | 检查配置、主题、预设和持久化权限 |
| `/activity` | 打开动画预设交互选择器 |
| `/activity frames <name>` | 直接切换预设，如 `/activity frames claude` |
| `/activity frames random` | 每轮随机一个预设 |
| `/activity narrate on\|off` | 开关模型自述 |
| `/activity mode lively\|minimal` | 总开关：花哨 / 极简 |
| `/activity feature` | 列出所有特性开关状态 |
| `/activity feature <名> on\|off\|auto` | 单特性开关，auto 恢复跟随模式 |
| `/activity status` | 显示当前所有配置 |
| `/activity warn <0-100>` | 修改上下文预警阈值，0=关闭 |
| `/activity danger <n>` | 修改红色危险阈值，必须不低于 warn 阈值 |
| `/activity tps on\|off` | 开关流式 `~tok/s` 估算显示 |
| `/activity remind <0-24>` | 设置累计活跃提醒间隔，0=关闭 |
| `/activity phrase add <文案>` | 追加自定义思考短语 |
| `/activity phrase list` | 列出所有自定义短语 |
| `/activity stats` | 本轮+会话统计：工具数、想/干比、💰成本、🔥token、缓存命中、思考 token |
| `/activity config export` | 导出当前配置 JSON 到当前目录 `working-activity.export.json` |
| `/activity config import <路径>` | 从文件导入配置并立即生效（自动校验） |

## 模型自述原理

1. 扩展通过 `before_agent_start` 把约定追加到该轮 system prompt：「每一步写 `⏵ 你正在做的事（≤20 字）`」
2. 模型在流式输出中写下 `⏵ 查一下报错原因`
3. 扩展实时解析 `text_delta`，提取最新 `⏵` 行展示在 Working 行
4. 每个 LLM turn 重置等待态；自述最低展示 2s，流式活跃时不消失，安静 5s 后退回普通文案

## 文案风格

- **中文**：短、口语、俏皮，不说教不摆谱
- **英文**：面无表情的冷幽默，穿插在中文文案中制造反差
- **游戏梗**（SSR、金色传说、gg、ez）只放在稀有彩蛋池（1/150 爆率），不影响日常使用

---

# DSH 版

> DeepSeek Harness 的实时"工作状态行"插件:模型的实时活动——俏皮思考文案、真正在跑的工具、已耗时、收尾摘要——在 agent 干活时展示在 Web UI 与 dsh-cc 终端上。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-working-activity
```

装好 [dsh-cc-tui](https://github.com/ccch1mneyyy/dsh-cc-tui) 后同装本插件,dsh-cc 状态栏会消费 `activity/status` 事件流渲染工作状态行。Web 端需要额外的 runtime 补丁,见下方文档。

## 文档

- [DSH 版完整文档](docs/dsh-working-activity.md)(原 dsh-working-activity 仓库 README:特性、挂载机制、配置、已知限制)
- 插件包 README:[`packages/activity/working-activity/README.md`](packages/activity/working-activity/README.md)(英文)与 [`README.zh.md`](packages/activity/working-activity/README.zh.md)

## 开发

```sh
cd packages/activity/working-activity
pnpm install && pnpm run build   # 构建(host tsc + client tsc,产物进 lib/)
pnpm run build:client           # 构建浏览器 bundle(tsdown → lib/client.js)
pnpm test                        # 单测 + 集成测试(状态机/文案/自述/集成)
```

## 已知限制

- 单一状态行:每会话一条,Web/终端消费端显示最近活跃会话。
- 无进度百分比:DSH 没有工具进度事件,长工具只显示已耗时。
- `publish` 默认关闭:追加 `activity/status` 会话事件目前会导致会话日志无法 resume,仅对支持 ignorable append 的宿主开启(详见插件 README)。

## 隐私与安全

两个版本都不采集、不上传任何数据,无网络请求、无遥测。pi 版配置与文案只存在本地;DSH 版 `activity/status` 仅写入本地会话日志(log-only 事件,模型不可见,回放忽略)。

## License

根仓库文档与 pi 版:`MIT`。DSH 插件包(`packages/activity/working-activity/`):`BSD-3-Clause`(见其 `package.json` 与 `LICENSE`)。
