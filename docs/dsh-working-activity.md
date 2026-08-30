# dsh-working-activity — DSH 实时工作状态行插件

> 非官方出品。DeepSeek Harness 的实时"工作状态行"插件：模型的实时活动 —— 俏皮思考文案、真正在跑的工具、已耗时、收尾摘要 —— 在 agent 干活时展示在 Web UI 与 dsh-cc 终端上。

作者：chimney（[@ccch1mneyyy](https://github.com/ccch1mneyyy)）

> 版权归作者本人所有。社区发布，非 DeepSeek 官方项目。

## 特性

- **实时状态行**：由会话事件（`turn/start`、`assistant/chunk`、`tool/call`、`tool/result`、`turn/end`）与 `agent/status` 驱动状态机（idle / waiting / thinking / tool / done）
- **趣味文案**：思考/等待/收尾/失败/深夜五个文案池，思考超时分档（30s / 1m / 5m），全部可关（`phrases: false` 变朴素标签）
- **模型自述（narrate）**：注入约定，模型在正文首行写 `⏵ 你正在做什么`；实时展示在状态行，聊天正文自动过滤该行（日志保留）
- **收尾统计**：`turn/end` 后展示 `搞定 ✓ · N 工具 · 想Xs 干Ys` + token 用量（灰条，仅 done 阶段）
- **两个出口**：Web UI（`conversation.input.dock` 工作状态行，slot 插件，零官方源码改动）+ dsh-cc 状态栏（消费同一 `activity/status` 事件流，渲染动画指示器 / 流光文案 / 上下文预警）

## 目录结构

```
packages/activity/working-activity/   插件本体（cordis 宿主插件源码 + 测试 +
                                      cordis.patch.yml 自挂载 bundle patch）
packages/activity/working-activity/   Web UI slot 插件（src/client/：入口 + WorkingLine
  src/client/                         组件 + CSS，经官方 rc.6 槽位机制挂载）
patches/webui-working-activity.patch  Web UI runtime 补丁（基于官方 rc.6：runtime 接
                                      activity/status 事件 + ConversationSnapshot.activity
                                      字段 + 测试 fixture 补齐；UI 侧零补丁，走 slot 插件）
```

## 安装

前置：官方 `dsh` CLI（`npm install -g @deepseek-ai/dsh`）与 `pnpm`（`dsh plugin`
把安装转发给 pnpm）。

### 1. 安装到 profile

```sh
dsh plugin --profile <你的 profile> add dsh-working-activity
```

本包自带 `dsh.bundle.patch`（自挂载 bundle）：`add` 会在 profile 内
`pnpm add` 安装，随后 CLI 的 reconcile 步骤检测到本包的 bundle 声明，自动把
它追加进 profile 的 `dsh.profile.bundles` 层列表；启动时本包的
`cordis.patch.yml` 会把自己 insert 进组合树——**无需任何手动挂载**。

> 注意：等价的手动方式是 `cd $DSH_HOME/profiles/<你的 profile> && pnpm add
> dsh-working-activity`，但 reconcile（把包追加进 `dsh.profile.bundles`）只
> 在 `dsh plugin` 命令里发生，手动 pnpm add 后需要自己把包名加进该 profile
> 的 `package.json` 的 `dsh.profile.bundles` 列表——直接用 `dsh plugin` 更省事。

源码方式（仅限 DSH monorepo 内开发调试）：把 `packages/activity/working-activity/`
整个目录复制到 monorepo 同路径，`pnpm install` 后即可被 workspace 解析。

### 2. Web 端（rc.6+，可选）

Web 端 = **runtime 补丁（数据通道）+ slot 插件（渲染，零官方源码改动）** 两段：

1. 在你的 DSH 源码仓库（官方 rc.6）根目录应用 runtime 补丁：
   ```sh
   git apply <本仓库>/patches/webui-working-activity.patch   # git apply --check 已验证
   ```
   它给 client runtime 接上 activity/status 事件并在 ConversationSnapshot 上带出
   `activity` 字段（外加测试 fixture 补齐，全倉 tsc/ vitest 不受影响）。不打这个补丁，
   Web 端状态行不显示（不报错，组件渲染空）。
2. slot 插件随本包 npm 分发（`lib/client.js`），web 宿主启动时经官方 client-modules
   机制自动挂载到 `conversation.input.dock` 槽位，无需手改 ui-conversation。

远期：官方若把 activity 字段合入发布线（或本插件升级为 session-projection 数据通道），
runtime 补丁即可退役。

### 3. 启用插件

装好后无需手动挂载：`dsh --profile <你的 profile>` 启动时本包的 bundle patch
会把自己挂进树。想调参时在该 profile 的用户补丁层
`$DSH_HOME/profiles/<你的 profile>/cordis.patch.yml`（顶层 YAML 数组，
`!!js` 可用）里按 id 覆盖 config——**不要再 insert 同名行**：

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500   # 状态快照发布间隔（越小越跟手）
```

**dsh-cc 效果**：装好
[dsh-cc-tui](https://github.com/ccch1mneyyy/dsh-cc-tui)（`dsh plugin --profile cc-tui add dsh-cc-tui`）
后同装本插件即可——cc-tui 状态栏第三行消费 `activity/status` 事件，渲染动画
指示器（28 预设，`config.activityFrames`）、白色流光文案、`⚠` 上下文预警与
`⏵` 自述，聊天正文自动过滤 `⏵` 行。建议把 `publishIntervalMs` 调到 `500`
让状态栏秒数跳动跟手；**推荐安装顺序是先 add 本包、再 add dsh-cc-tui**（这样
cc-tui bundle patch 里对 `working-activity` 行的 `publishIntervalMs: 500`
覆盖能命中本行；反过来会因行尚未存在而打一条警告后跳过，需自己在用户层
覆盖）：

```sh
dsh plugin --profile cc-tui add dsh-working-activity
dsh plugin --profile cc-tui add dsh-cc-tui
```

### 4. 配置

| Key | Type | Default | Meaning |
|---|---|---|---|
| `phrases` | `boolean` | `true` | 趣味文案池；`false` 渲染朴素功能标签 |
| `publish` | `boolean` | `true` | 追加 `activity/status` 会话事件供 UI 消费（Web UI / dsh-cc） |
| `tickMs` | `number` | `500` | 状态渲染 tick 间隔（100–5000） |
| `publishIntervalMs` | `number` | `2000` | 稳定行最小发布间隔（500–30000）；dsh-cc 建议 `500` |
| `detailLimit` | `number` | `40` | 展示细节最大长度（路径/命令/模式），8–120 |
| `customActions` | `object` | `{}` | 工具名精确匹配 → 动作文案池 |
| `narrate` | `boolean` | `true` | 注入 `⏵` 自述约定并实时展示 |

## Web UI 集成（rc.6 槽位机制）

### 挂载机制（调研结论）

官方 rc.6 web 客户端的客户端模块系统（`@deepseek-ai/dsh-client-modules`）
自动装配第三方 UI：**不需要改官方源码，也不需要注册中心**。装配链：

```
host Loader 条目（cordis.yml / bundle patch）
  → 包 package.json 声明 dsh.client: { platform: 'web', ... }
  → client-modules 扫描 ctx.loader.entries()，解析 exports["./client"]
  → 组合进 window.__DSH_BOOT__ 图，serve /plugins/<包名>/client.js
  → 浏览器端 ClientModuleSystem 加载 bundle（closure-factory 格式）
  → 包内 apply(ctx) 执行 → ctx.slots.register('conversation.input.dock', …)
  → 会话视图 composer 上方渲染工作状态行
```

关键约束（官方 `packages/client/modules/src/index.ts` 实现）：

- **subpath 必须是 `./client`**：client-modules 只解析 `exports["./client"]`
  （字符串或 `{ default }` 条件形式），其他名字（如 `./webui`）不会被扫到。
- **必须声明 `dsh.client`**：`platform: 'web'` 必填，`inject` 列出依赖的
  client 模块（用于组装期依赖图），可选 `immediately` 预取。
- **bundle 必须是官方 closure-factory 格式**：产物文件调用
  `window.__ModuleLoader__.load({ id, factory })`，外部依赖经注入的
  `require` 从平台模块表解析；CSS Modules 内联进 bundle 并自动注入
  `<style data-plugin>`。普通 tsc 产物不能直接 serve。
- **平台模块必须保持 external**：`react`、`@deepseek-ai/dsh-client-ui-slots`
  等是 shell 的冻结模块表条目，第三方 bundle 不得内联（否则运行时 identity
  分裂）。本包 `tsdown.config.ts` 已镜像官方的 external 表与纯度门。
- **bundle 缺失会 loud fail**：声明了 `dsh.client` 但 `lib/client.js` 不存在
  时，client-modules 激活阶段直接抛 `MissingClientBundleError`，web 起不来
  —— 挂载前务必先构建。

### 本包已交付的接入件

| 文件 | 作用 |
|---|---|
| `src/client/index.ts` | slot 插件入口：`apply(ctx)` 注册
  `conversation.input.dock` 条目（id `activity`，order 15，goal 条与 queue 行
  之间），声明 `inject: ['slots']` |
| `src/client/WorkingLine.tsx` | 工作状态行组件：经标准 kit 的 `useSession`
  读 `snapshot.activity`；idle/空行不渲染；waiting/thinking/tool 呼吸动画
  指示器 + 状态行 + 工具计数徽标，done 稳态品牌色 |
| `src/client/WorkingLine.module.css` | 行/指示器/徽标样式（rc.6 设计 token：
  `--dsw-alias-*`、`--dsh-composer-card-max-width`） |
| `src/client/activity.ts` | `ActivitySnapshot` 类型 + 对
  `@deepseek-ai/dsh-client-runtime/client` 的 `ConversationSnapshot` 声明合并
  （runtime 补丁合入官方后删除该块） |
| `tsdown.config.ts` | client bundle 构建（镜像官方 `clientBundle` 预设：
  closure-factory banner/footer、平台 external、CSS 内联、纯度门） |
| `tsconfig.client.json` | client 侧类型编译（jsx/DOM lib，产物
  `lib/types/client/`） |

### 挂载步骤（用户视角）

1. **装包**（已有 profile 则跳过）：
   `dsh plugin --profile <你的 profile> add dsh-working-activity`
2. **构建 bundle**：`npm run build:client`（产出 `lib/client.js`；包内
   `npm run build` 已串起 host + client 两侧 tsc，`build:client` 出浏览器
   bundle）。发布包需把 `lib/client.js` 一并带上（`files` 已含 `lib`）。
3. **确保 host 的 web 组合树有官方 client 模块**：`dsh web` 的 profile 需
   装配 `@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-conversation`、
   `dsh-client-ui-slots`（官方 web-app bundle 默认包含；`dsh.client.inject`
   已在 package.json 声明）。
4. **等 runtime 补丁**：`ConversationSnapshot.activity` 需官方
   `dsh-client-runtime` 合入 runtime 补丁后才有运行时数据；在此之前组件
   恒返回 null（类型已由声明合并补齐，不报错）。
5. **验收**：`dsh web` 打开会话页，模型干活时 composer 卡片上方出现
   状态行（阶段色呼吸点 + 文案 + 工具徽标），回合结束变稳态摘要。

### 与旧补丁的关系 / 取舍

- 旧补丁直接改 `ui-conversation` 源码（TurnStatus 回合标签 + WorkingLine
  dock 行），每版官方更新都要重打；slot 插件只贡献注册，官方槽位机制
  自动装配，**升级零冲突**。
- **不做 `conversation.chat.turnTail` 回合标签**：该链槽位的 `select` 只
  能基于回合 owner（Turn/seq）派生匹配，而 activity 是会话级节流快照，
  不绑定具体回合节点，强行接入只能"永远匹配 + 组件内再判空"，违反官方
  "先派生匹配再挂载"的链槽准则；且 done 摘要放在 dock 行已覆盖同一信息
  （旧补丁的 WorkingLine 也是只渲染 done 摘要）。需要回合级收尾标签时
  应由消息域事件（而非 activity 流）驱动。

## 隐私与安全

- 插件**不采集、不上传任何数据**。全部状态由本机会话事件推导，`activity/status`
  仅写入本地会话日志（log-only 事件，模型不可见，回放忽略）。
- 无网络请求、无遥测、无外部依赖注入；`customActions`/文案池只存在你的本地配置里。
- 许可证：BSD-3-Clause（见插件包 `package.json`；本仓库说明文档 MIT）。

## 已知限制

- 单一状态行：每会话一条，Web/终端消费端显示最近活跃会话。
- 无进度百分比：DSH 没有工具进度事件，长工具只显示已耗时。
- 无动画帧：事件载荷为静态文本片段（dsh-cc 渲染侧自带动画指示器与流光）。
- Web 单入口：`conversation.input.dock` 状态行覆盖全部阶段（waiting /
  thinking / tool / done），无回合级标签（取舍见「Web UI 集成」）。

## 开发

```sh
pnpm install && pnpm run build   # 构建（host tsc + client tsc，产物进 lib/）
pnpm run build:client           # 构建浏览器 bundle（tsdown → lib/client.js）
pnpm test                        # 单元测试 + Host 集成测试
pnpm run test:alpha2             # 隔离的 DSH 0.1.2-alpha.2 Host 集成测试
```

> 主开发树保留 rc.6 Host/Web 基线；`test:alpha2` 使用独立 fixture 和锁文件加载
> 已发布的 `@deepseek-ai/dsh-*@0.1.2-alpha.2`，避免把两套互斥 peer 图混装。
> 不再需要 DSH 源码 workspace 链接。
