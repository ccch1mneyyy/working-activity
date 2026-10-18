# GUI 兼容性核查：deepseek-harness-desktop（Tauri）

> 核查对象：`/home/arch/deepseek-harness-desktop`（`deepseek-harness-desktop@0.22.4`，checkout `4041db5c`，2026-10-09）
> 插件：`dsh-working-activity@0.6.0`（2026-10-19 工作树，RC2 适配后的声明与 bundle）
> 静态核查脚本：`packages/activity/working-activity/scripts/verify-gui-contract.mjs`
> 结论：**客户端 bundle 不需要 GUI 专用适配代码**。GUI 的聊天面就是官方 DSH Web 客户端（iframe），与本包已适配的 WebUI 共用同一个 `dsh-client-modules` 冻结模块表和同一套 `dsh.client` 装配链；`platform: "web"`、seed externals、React peer、CSS Modules 注入、`conversation.input.dock` 均通过。
> 运行时声明门禁也已通过：当前 peer 区间在 `includePrerelease` 语义下覆盖 GUI 0.22.4 推荐内核 `0.2.0-rc.2`、本机活动内核 `0.2.1-rc.2` 与旧线 `0.1.7-rc.2`（§4/§6.1）。剩余风险是 GUI 未来换到 peer 区间之外的新内核线时，内核会静默跳过本插件——发布前用脚本 `--strict-baseline` 复跑即可捕获。

---

## 1. 核查对象与版本矩阵

| 维度 | 值 | 证据 |
| --- | --- | --- |
| GUI 仓库 / 版本 | `deepseek-harness-desktop` 0.22.4，checkout `4041db5c` | `deepseek-harness-desktop/package.json:4` |
| GUI 推荐 DSH 内核 | `0.2.0-rc.2`（最低声明 `0.1.5-rc.1`） | `deepseek-harness-desktop/src-tauri/resources/manifest.jsonc:4-5`；README 基线表 `README.md:124` / `README.en.md:125` |
| GUI dev catalog（DSH 客户端线） | `@deepseek-ai/dsh-client-*` = `0.2.1-alpha.1` | `deepseek-harness-desktop/pnpm-workspace.yaml:135-160`（如 `:149` conversation、`:152` renderer） |
| GUI 宿主应用 React | `^19.2.8`（仅外层 Tauri UI） | `deepseek-harness-desktop/pnpm-workspace.yaml:182`；根依赖 `package.json:45` |
| 内嵌 Web 客户端 React | **18.3.1** | 内核 `dsh-web-frontend` 产物内的 `version:"18.3.1"`（见 §3.3） |
| 本机可核对内核 A | `@deepseek-ai/dsh@0.2.1-rc.2`（`~/.dsh-runtime` 活动内核） | `~/.dsh-runtime/npm/lib/node_modules/@deepseek-ai/dsh/package.json:4` |
| 本机可核对内核 B | `@deepseek-ai/dsh@0.2.0-rc.2`（备份） | `~/.dsh-runtime/backups/dsh-0.2.0-rc.2/package.json:4` |
| 插件版本 | `dsh-working-activity@0.6.0` | `packages/activity/working-activity/package.json:4` |

> GUI 的 catalog `0.2.1-alpha.1` 只用于 GUI 插件仓库的 typecheck/构建；GUI 运行时用的是用户机器上按资源清单下载的 DSH 内核，二者不要混为一谈。

## 2. 加载链路：GUI 没有自己的 module table

GUI 不打包聊天前端。Tauri 壳启动本机 `dsh web` 后，把内核返回的 `service_url` 作为 iframe `src`：

```
Tauri (React 19 宿主 UI)
  └─ iframe src = core service_url                       src/layout/components/iframe.tsx:584
       └─ src/store/modules/harness/store.ts:430         （service_url 来自核心进程）
            └─ DSH web shell（Vite 产物，React 18.3.1）
                 └─ dsh-client-modules 冻结模块表 → /plugins/<pkg>/client.js
                      └─ window.__ModuleLoader__.load({id, factory})
                           └─ factory(require) → apply(ctx) → ctx.slots.register(...)
```

证据链：

- 内核进程把每个客户端插件的 bundle 挂在 `/plugins/<包名>/client.js`；GUI 的健康检查直接探测这些 URL：`deepseek-harness-desktop/src-tauri/src/service/workflow/utils.rs:45-50`。
- 模块系统属于内核：`dsh-client-modules` 的 README 明确“shell seeds a frozen module table… every dynamic bundle resolves its externals against exactly that baseline”；解析顺序是 platform seed → memoized → graph row → registered factory，其余一律抛错（`~/.dsh-runtime/npm/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md:48-50,70-72`）。
- GUI 自己的插件与 working-activity 走完全相同的声明：`dsh.client.platform = "web"` + 真实 boot row 的 `inject`（`deepseek-harness-desktop/packages/dsh-tauri-worktree/package.json:36-45`、`packages/dsh-tauri-ui/package.json:39-48`、`packages/dsh-tauri/package.json:40-43`）。
- GUI 自己的 client bundle 也用同一个 loader 外壳与平台 external 表（`deepseek-harness-desktop/packages/dsh-tauri-tsdown/src/index.ts:33,41-48`；该文件 `:53-60` 的注释直接说明“模块表只认识平台种子词与已加载的链接模块”）。
- 因此 **WebUI 的 client 兼容性结论可以直接迁移到 GUI**；GUI 侧只多了“插件安装/profile 装配/启动期文本补丁”三件事。

working-activity 的接入件：

- `dsh.client`：`packages/activity/working-activity/package.json:73-85`（`platform: "web"`、inject conversation/renderer/session）。
- bundle 入口：`exports["./client"] → lib/client.js`（`package.json:13-16`）、closure-factory 外壳（`lib/client.js:1-7`）。
- 宿主装配：`dsh.bundle.patch` + `cordis.patch.yml:17-19` 的 `insert: working-activity`。
- 客户端注册：`src/client/index.ts:29,36-43`；组件读投影：`src/client/WorkingLine.tsx:81`。

## 3. 逐项核对

### 3.1 `dsh.client` 声明：合法

`platform: "web"` 是 GUI 内核唯一会消费的 platform；`inject` 3 个包都是当前 `dsh-web-app` 组合里真实存在的 boot row（不是 seed-only 的 `ui-slots`）：

- 声明：`packages/activity/working-activity/package.json:77-84`。
- 内核侧对应行：conversation / renderer / session 在 `dsh-web-app/cordis.patch.yml` 中分别注册为 Loader 条目（0.2.1-rc.2：`:327` / `:270` / `:273`；0.2.0-rc.2：`:309` / `:252` / `:255`）。
- 每个 inject 包自身 `dsh.client.platform = "web"`（脚本会逐核核对；`@deepseek-ai/dsh-client-ui-slots` 在 0.2.x 已不发布为包，只是模块表 seed，不能写进 `inject`——这也是当前声明只列三个包的原因）。

### 3.2 seed 表 / externals：bundle 只需要 `react/jsx-runtime`

working-activity 的 client bundle 实际只 `require("react/jsx-runtime")`（`lib/client.js:7`），其它 `@deepseek-ai/*` 都是 type-only import（构建期擦除）。两份内核的冻结模块表都覆盖它：

| 内核 | 模块表成员（节选自 `dsh-web-frontend/dist/assets`） | 证据 |
| --- | --- | --- |
| 0.2.1-rc.2 | `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit` | `index-CN7NIWNw.js`，`function SZ(){return{react:...}}` |
| 0.2.0-rc.2 | 同上，去掉 `zod` / `@tanstack/react-virtual` 两项 | `index-5SrrfWpU.js`，`function rM(){return{react:...}}` |

- 构建侧的 external 表已与 RC2 模块表对齐：`packages/activity/working-activity/tsdown.config.ts:27-46`。
- 0.1.x 的 `dsh-client-web-react`、`dsh-client-ui-attachment`、`dsh-client-schema-form` 已从 0.2.x 模块表消失；当前配置已移除它们（`tsdown.config.ts:27-33` 的注释记录了这次漂移）。
- 现有 bundle 门禁还会在加载器 stub 下求值并校验 slot 注册形状：`node scripts/verify-client-bundle.mjs`（`scripts/verify-client-bundle.mjs`，当前输出 OK）。

### 3.3 React：两个 React 不要混淆

- **插件运行所在的 React 是内核 Web shell 的 React 18.3.1**：两份内核产物都带 `version:"18.3.1"`（0.2.1-rc.2 `index-CN7NIWNw.js`；0.2.0-rc.2 `index-5SrrfWpU.js`）。`react` / `react/jsx-runtime` 是 seed word，插件 bundle 不能内联自己的 React。
- **GUI 宿主的 React 19.2.8 不进入 iframe**：它只渲染 Tauri 外壳（导航、设置、插件管理等），与 `frame-src http://127.0.0.1:*` 的内核文档是不同文档/不同 React 树（`deepseek-harness-desktop/src-tauri/tauri.conf.json` 的 CSP；iframe 来源见 §2）。GUI 与 iframe 之间只有 postMessage 桥。
- 本包 peer 同时覆盖两条线：`"react": "^18.2.0 || ^19.0.0"`（`packages/activity/working-activity/package.json:98`）。覆盖 18.3.1 是运行时正确性要求；覆盖 19 是防止 GUI 侧/宿主 profile 解析出冲突 React 副本（GUI 宿主声明 React 19），两者都由脚本硬断言。
- 结论：GUI 的 React 19 **不要求**插件改 client 代码；插件也不应该把 React 升到 19 dev 依赖去“迎合”宿主，运行期 seed 仍是内核的 18.3.1。

### 3.4 CSS Modules 注入：bundle 自带，内核不拦

`WorkingLine.module.css` 由 lightningcss 编译成 CSS 字符串，并在 factory 执行时（即模块 materialize 时）注入 `<style data-plugin="dsh-working-activity">`：

- 构建规则：`packages/activity/working-activity/tsdown.config.ts:115-145`（`:137-141` 为 `createElement("style")` / `dataset.plugin` / `appendChild`）。
- 产物已包含同一段注入逻辑（`lib/client.js` 中 `createElement("style")` 与 `dataset.plugin`）。
- `dsh-client-modules` 明确把“CSS injection”列入 factory 闭包副作用（core README:70-72），GUI 的 iframe 是普通文档，`document.head` 可用；GUI 启动期补丁也不改 style 注入路径。

### 3.5 `conversation.input.dock`：存在、session scope、可并存

- 槽位声明（内核 `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`）：
  - 0.2.1-rc.2 `:295-300`：`kind: 'list'`、`scope: 'session'`、`owner: InputZone`。
  - 0.2.0-rc.2 `:214-219`：同上。
- `InputZone` 只提供 `{session, input}` 给 owner；`useProjection` 来自 session 标准 kit（`dsh-client-ui-session/lib/types/client/index.d.ts`，0.2.1-rc.2 `:86`/`:96`，0.2.0-rc.2 `:83`/`:91`），因此组件解构 `useProjection` 是合法契约，不是私有 transport。
- 插件注册形状：`src/client/index.ts:36-43`（`id: activity`、`order: 15`、`registrant: dsh-working-activity`，`inject: ['slots']` 于 `:29`）。
- 共存性：`conversation.input.dock` 是 list 型槽。官方条目 `todo` order 0、`goal` order 10、`queue` order 20（内核 `dsh-client-ui-conversation/lib/client.js:17205-17208`、`dsh-client-ui-goal/lib/client.js:604-607`、`ui-conversation/lib/client.js:19300-19305`）；GUI 自带条目为负 order（`dsh-tauri-experimental` running-chip `-30`、`dsh-tauri-worktree` mode-select `-20` / surface `-10`：`packages/dsh-tauri-experimental/src/client/constants/index.ts:15-18`、`packages/dsh-tauri-worktree/src/client/constants/index.ts:5,8,10`）。id 与 order 均不冲突，working line 稳定落在 goal 与 queue 之间。
- 槽位是 session-scoped：只在有当前会话时渲染，插件组件在 `activity === undefined / idle / line === ''` 时返回 `null`（`src/client/WorkingLine.tsx:69-88`），不会在空白会话里占位。

### 3.6 宿主装配与 GUI 启动期补丁

- 插件以 profile bundle 形式装配：`dsh.bundle.patch` + `cordis.patch.yml:17-19`；GUI 的 profile 名为 `tauri`（`deepseek-harness-desktop/src-tauri/src/service/profile/mod.rs:53`），安装经核心 CLI `dsh plugin … add`（`src-tauri/src/service/plugin/install/single.rs:140`）。
- GUI 启动前会对**活动内核的 client bundle**做最佳努力文本补丁（composer、renderer、mobile_sidebar 等 12 个文件：`src-tauri/src/service/patch/mod.rs:36-39` 的补丁列表）；这些补丁不触碰 `conversation.input.dock`（脚本扫描确认；`composer.rs:1-39` 只放宽 workspace-less 会话的 inert 判定）。补丁按锚点命中，锚点漂移时跳过并告警，不会静默改坏插件。

## 4. 支持矩阵（按 GUI 实际使用的内核）

| GUI 使用的 DSH 内核 | client bundle 可加载（seed/React/dock） | 核心插件门禁 | 结论 |
| --- | --- | --- | --- |
| `0.2.0-rc.2`（GUI 0.22.4 推荐基线） | 通过（seed 含 `react/jsx-runtime`；React 18.3.1；dock 契约一致） | 通过（peer 含 `^0.2.0-rc.2`） | **可用**（GUI 默认基线） |
| `0.2.1-rc.2`（本机活动内核） | 通过 | 通过（`includePrerelease` 语义下 `^0.2.0-rc.2` 覆盖） | **可用**（推荐验证目标） |
| `0.2.1-alpha.1`（GUI dev catalog，不是运行时） | 不适用（GUI 不把 catalog 版本装进 profile） | 通过（声明层同样被 `^0.2.0-rc.2` 覆盖） | 仅供参考；不构成运行时支持声明 |
| `0.1.7-rc.2`（旧 WebUI 线） | 未核对（本报告只核对 0.2.x 内核） | 通过（旧 peer 保留） | 声明上仍兼容；GUI 0.22.4 不使用该线，本报告未实测 |

## 5. 已验证项 vs 未验证项

**已静态验证（脚本可重复执行）**

1. `dsh.client.platform = "web"`、`inject` 均为真实 boot row、`exports["./client"]` 存在。
2. `lib/client.js` 是单个 `window.__ModuleLoader__.load({ id: "dsh-working-activity", factory })`；除 `react/jsx-runtime` 外没有其它 module-table 请求。
3. 两份内核的冻结模块表覆盖该请求；React 18.3.1 与 GUI 宿主 React 19.2.8 都在 peer 区间内。
4. `conversation.input.dock` 在两份内核里均为 `kind: list` / `scope: session`，且 session 标准 kit 提供 `useProjection`。
5. GUI 自身插件使用相同 `platform: "web"` 管线与相同 loader 外壳；GUI webview 加载的是内核 `service_url`，没有第二张 module table。
6. GUI 启动期补丁不触碰 dock 槽位。
7. 运行时门禁：`--strict-baseline` 下 GUI 0.22.4 推荐内核 `0.2.0-rc.2` 与两份已安装内核 `0.2.1-rc.2` / `0.2.0-rc.2` 均被 peer 区间接纳（当前 `31 ok / 0 warn / 0 fail / 0 skip`）。

**未验证（只能真实启动 GUI 才能覆盖）**

1. 真实 GUI 进程中的“插件安装 → 内核重启 → composer 上方出现工作行”端到端流程。本仓库的 AGENTS.md 禁止在插件开发时执行 desktop build（`deepseek-harness-desktop/AGENTS.md:39`，用户可能正在热重载），且本机未安装 GUI 应用；本次只读源码。
2. working-activity **宿主半**（session projection 注册、`activity/status` 折叠）在 0.2.x 的行为——由 `working-activity-rc2-compat` 套件与另一条 WebUI 适配任务覆盖，不在本报告范围。
3. GUI 其它版本（除 0.22.4 checkout）的补丁锚点与内核推荐版本；版本矩阵需要随 GUI release 更新。
4. CSS 注入的视觉回归（行高、主题 token）——需要真实渲染环境截图比对。

## 6. 限制与风险

### 6.1 运行时门禁：当前通过，升级内核线时最易回归

内核在装载 profile bundle 时逐个核对 `engines.dsh`；未声明时，**每个 `@deepseek-ai/dsh-*` peer 都必须匹配运行时内核版本**，预发布参与比较（`dsh-app-boot/lib/index.js:277-300,311-328`）。不匹配的 bundle 会被跳过（同文件 `:1025`；普通 Loader 行则被禁用，`:2327` 附近的 `prepareProfileEntries`）；表现是 dock 行完全不出现，且客户端 console 没有 module-table 报错。GUI 安装插件时先经核心 CLI `dsh plugin add`（`deepseek-harness-desktop/src-tauri/src/service/plugin/install/single.rs:140`），GUI 自己的预检也只读 DSH 家族 peer（`src-tauri/src/service/plugin/compat.rs:28,53-72,153-166`）。

当前 `package.json` 的 RC2 peer 已统一为 `^0.1.7-rc.2 || ^0.2.0-rc.2`（`packages/activity/working-activity/package.json:86-98`）。脚本按内核的 `semver.satisfies(..., { includePrerelease: true })` 语义逐版本核对：

| 运行时版本 | 门禁 | 说明 |
| --- | --- | --- |
| `0.2.0-rc.2`（GUI 0.22.4 推荐基线） | 通过 | `--strict-baseline` 硬断言，当前通过 |
| `0.2.1-rc.2`（本机活动内核） | 通过 | `^0.2.0-rc.2` 在含预发布语义下覆盖 |
| `0.2.1-alpha.1`（GUI dev catalog） | 通过（声明层） | 只用于 GUI 仓库构建，不进入运行时 |
| `0.1.7-rc.2`（旧 WebUI 线） | 通过 | 保留旧区间 |

风险：只要 GUI 把推荐内核抬到 `^0.2.0-rc.2` 上界之外（`0.3.x` 或新的预发布线），或 peer 更新滞后于 GUI 基线，bundle 就会再次被静默跳过。发布前固定跑 `node scripts/verify-gui-contract.mjs --strict-baseline`；失败时按顺序选择：放宽 peer、显式声明 `engines.dsh`（覆盖 peer 判定）、或临时
`dsh plugin --profile tauri allow-version dsh-working-activity@0.6.0 --dsh-version <核心版本> --accept-risk`
（逐版本豁免，不是长期方案）。

### 6.2 其它限制

- **静态核查的边界**：模块表与 React 版本是从内核压缩产物里按函数标记提取的；上游若改压缩布局，脚本会降级为 WARN 并提示重新确认，不会假装通过。
- **peer 门禁模拟**依赖内核 `dsh-app-boot` 的 `semver.satisfies(..., { includePrerelease: true })` 语义；脚本会读取实现标记，语义变化时告警。
- **GUI 启动期文本补丁**按压缩源码锚点匹配（`src-tauri/src/service/patch/`），上游升级可能让补丁静默跳过；这不影响本插件，但会改变 GUI 能力面。
- **React 19 覆盖是声明层防御**：插件运行期仍是内核的 React 18.3.1；若未来内核把 Web shell 升到 React 19，peer 已覆盖、bundle 的 `react/jsx-runtime` 请求不变，但仍需真实 GUI 回归。
- **0.2.1-alpha.1** 是 GUI 的 dev catalog 版本，不可拿来判断运行时兼容；GUI 用户实际拿到的是资源清单推荐版本或手动更新的版本。

## 7. 安装 / 启用建议

1. **先构建 client bundle**（GUI/内核只 serve 已构建产物；缺失会 `MissingClientBundleError`，整个 web 起不来）：
   ```sh
   cd packages/activity/working-activity
   pnpm run build:client          # 产出 lib/client.js
   node scripts/verify-client-bundle.mjs
   node scripts/verify-gui-contract.mjs
   ```
2. **内核版本**：GUI 0.22.4 推荐基线 `0.2.0-rc.2` 与本机活动内核 `0.2.1-rc.2` 都在当前 peer 区间内（§6.1），无需为 GUI 特别降级或升级。若 GUI 后续把推荐内核抬到 `0.3.x`，按 §6.1 的风险处置流程重跑门禁再发布。
3. **安装到 GUI 的 `tauri` profile**：通过 GUI 插件管理器安装，或
   ```sh
   dsh plugin --profile tauri add <包路径或 registry spec>
   ```
   构建产物、`dsh.bundle.patch` 与 `cordis.patch.yml` 都随包发布（`files` 含 `lib`、`src`、`cordis.patch.yml`）；安装后重启 GUI（或让插件管理器重启内核服务）。
4. **验收**：会话进行中 composer 卡片上方出现工作行（阶段色呼吸点 + 文案 + 工具徽标），idle/首次提交前不占位；浏览器 console 不应出现 `missed the module table` 或 `requested external ... before the module system existed`。
5. **每次插件或 GUI 升级后重跑**：
   ```sh
   node packages/activity/working-activity/scripts/verify-gui-contract.mjs
   # 指定 GUI / 内核路径（发布包或其它机器）：
   DSH_GUI_ROOT=/path/to/deepseek-harness-desktop \
   DSH_CORE_ROOT=/path/to/@deepseek-ai/dsh \
     node scripts/verify-gui-contract.mjs
   # 把“GUI 推荐内核被门禁拒绝”升级为硬失败（CI 建议）：
   node scripts/verify-gui-contract.mjs --strict-baseline
   ```

## 8. 复现与反向自测

```sh
cd packages/activity/working-activity

# 正例（本机：GUI 0.22.4 + 内核 0.2.1-rc.2 / 0.2.0-rc.2）
node scripts/verify-gui-contract.mjs

# 机器可读
node scripts/verify-gui-contract.mjs --json

# GUI 源码不存在 → 优雅跳过并说明（退出码 0）
DSH_GUI_ROOT=/tmp/nope node scripts/verify-gui-contract.mjs

# 指定内核（语义化定位，不依赖 ~/.dsh-runtime 布局）
DSH_CORE_ROOT=~/.dsh-runtime/npm/lib/node_modules/@deepseek-ai/dsh \
  node scripts/verify-gui-contract.mjs
```

脚本的非零退出已用以下反向场景实测（任一都会打印具体缺项并以 1 退出）：

| 反向场景 | 触发方式 | 脚本报出 |
| --- | --- | --- |
| bundle 未构建 | 删除 `lib/client.js` | `plugin.exports: … does not exist — build it first` |
| platform 不是 web | 改 `dsh.client.platform = "desktop"` | `plugin.dsh.client: … GUI core only composes 'web'` |
| React peer 不覆盖 19 | 把 react peer 改回 `^18.2.0` | `gui.host.react: GUI host React 19.2.8 is outside …` |
| inject 写了 seed-only 包 | 把 `@deepseek-ai/dsh-client-ui-slots` 加回 `inject` | `… names packages that are not web boot rows` |
| 内核模块表缺 seed | 假内核的 `PLATFORM_MODULES` 去掉 `react/jsx-runtime` | `… materialization throws "missed the module table"` |
| 运行时门禁回归 | 在副本中把 RC2 peer 收窄回 `^0.2.1-rc.2`，跑 `--strict-baseline` | `gui.baseline.gate: GUI recommended core 0.2.0-rc.2 is denied` |

> `WA_PACKAGE_ROOT=/copy/of/working-activity` 是脚本的测试钩子，可在不触碰工作树的情况下对副本做上述变异。

## 9. 证据索引

| 结论 | 证据（文件:行） |
| --- | --- |
| GUI 聊天面是内核 Web 客户端 | `deepseek-harness-desktop/src/layout/components/iframe.tsx:584`；`src/store/modules/harness/store.ts:430` |
| 内核按 `/plugins/<pkg>/client.js` 服务插件 | `deepseek-harness-desktop/src-tauri/src/service/workflow/utils.rs:45-50` |
| 模块表是内冻结 seed 表，解析失败即抛错 | 内核 `dsh-client-modules/README.md:48-50,70-72` |
| GUI 插件使用同一 `dsh.client` 管线 | `deepseek-harness-desktop/packages/dsh-tauri-worktree/package.json:36-45`；`packages/dsh-tauri-ui/package.json:39-48` |
| GUI loader 外壳与 externals 与插件一致 | `deepseek-harness-desktop/packages/dsh-tauri-tsdown/src/index.ts:33,41-48,53-60` |
| 插件声明 `platform: web` / inject / exports | `packages/activity/working-activity/package.json:13-16,73-85` |
| 插件 bundle 只 require `react/jsx-runtime` | `packages/activity/working-activity/lib/client.js:1-7` |
| bundle patch 挂载宿主行 | `packages/activity/working-activity/cordis.patch.yml:17-19` |
| 两份内核模块表 | `~/.dsh-runtime/.../dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（`function SZ()`）；`~/.dsh-runtime/backups/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js`（`function rM()`） |
| 内嵌 Web React 18.3.1 | 同上两份产物中的 `version:"18.3.1"` |
| GUI 宿主 React 19 | `deepseek-harness-desktop/pnpm-workspace.yaml:182`；`package.json:45` |
| dock 契约（list/session） | 内核 `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`：0.2.1-rc.2 `:295-300`；0.2.0-rc.2 `:214-219` |
| `useProjection` 标准 kit | 内核 `dsh-client-ui-session/lib/types/client/index.d.ts`：0.2.1-rc.2 `:86,96`；0.2.0-rc.2 `:83,91` |
| 官方 dock order（todo 0 / goal 10 / queue 20） | 内核 `dsh-client-ui-conversation/lib/client.js:17205-17208,19300-19305`；`dsh-client-ui-goal/lib/client.js:604-607` |
| GUI dock order（-30 / -20 / -10） | `deepseek-harness-desktop/packages/dsh-tauri-experimental/src/client/constants/index.ts:15-18`；`packages/dsh-tauri-worktree/src/client/constants/index.ts:5,8,10` |
| 插件 dock 注册 | `packages/activity/working-activity/src/client/index.ts:29,36-43`；`src/client/WorkingLine.tsx:81` |
| CSS Modules 注入 | `packages/activity/working-activity/tsdown.config.ts:115-145`（`:137-141` 注入 style） |
| 内核 peer 门禁 | 内核 `dsh-app-boot/lib/index.js:277-300,311-328,1025,2327` |
| 当前 peer 区间通过 GUI 推荐基线 | `packages/activity/working-activity/package.json:86-98`；`node scripts/verify-gui-contract.mjs --strict-baseline` 输出 `gui.baseline.gate: … admitted` |
| GUI 安装走核心 CLI + 预检只看 DSH 家族 peer | `deepseek-harness-desktop/src-tauri/src/service/plugin/install/single.rs:140`；`src-tauri/src/service/plugin/compat.rs:28,53-72,153-166` |
| GUI 启动期补丁面 | `deepseek-harness-desktop/src-tauri/src/service/patch/mod.rs:36-39`；`composer.rs:1-39` |
| GUI profile 名 | `deepseek-harness-desktop/src-tauri/src/service/profile/mod.rs:53` |
