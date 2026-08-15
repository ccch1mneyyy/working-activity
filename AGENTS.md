# working-activity 项目规则

## 用途
"工作状态行"扩展的开源仓库,一个仓库维护两个平台适配:
- **pi 版**:源码 `extensions/index.ts`(无构建,pi 直接加载 TS),发布 npm 包 `pi-working-activity` 供 `pi install npm:pi-working-activity`
- **DSH 版**:插件在 `packages/activity/working-activity/`(cordis 宿主插件 + `src/client/` Web slot 插件),发布 npm 包 `dsh-working-activity` 供 `dsh plugin --profile <p> add dsh-working-activity`

## pi 版开发约定
- 唯一源码:`extensions/index.ts`(无构建,pi 直接加载 TS)
- 本机活动副本:`C:\Users\17481\.pi\agent\extensions\working-activity.ts`,改完同步 + `/reload`
- 语法校验:`node --experimental-strip-types`(import 包解析失败是预期)
- 调试:`working-activity.json` 里 `debugLog: true`

## DSH 版开发约定
- 插件源码:`packages/activity/working-activity/src/`(host 插件)+ `src/client/`(Web slot 插件)
- 构建:`cd packages/activity/working-activity && pnpm install && pnpm run build`(`build:client` 出浏览器 bundle)
- 测试:`pnpm test`(vitest,依赖已发布到 npm 的官方 `@deepseek-ai/dsh-*@0.1.0-rc.6` 包,无需源码 workspace)
- 自挂载 bundle:`cordis.patch.yml`,`dsh plugin add` 自动装配,无需手动挂载
- Web 端需 runtime 补丁:`patches/webui-working-activity.patch`(应用到官方 rc.6 源码仓库,`git apply --check` 验证)
- 完整文档:`docs/dsh-working-activity.md`(原 dsh 仓库 README)

## 文案
- 开源文案(README + 状态栏短语池)优先用 **DeepSeek 官方 V4 Pro** 生成
- 生成脚本:`.local/gen-with-ds.cjs` / `.local/gen-phrases.cjs` / `.local/apply-phrases.cjs`(不入库)
- 输出缓存:`.local/ds-gen/`(不入库)
- 风格:短、口语、俏皮、有活人感;游戏梗仅 rare 池;允许 deadpan 英文

## 发布
- pi 版:semver 功能 minor,修 bug patch;发布前 `npm view pi-working-activity` 确认包名;在**仓库根目录** `npm publish`
- DSH 版:在 `packages/activity/working-activity/` 内 `npm publish`;发版前确认 `package.json` 的 version 与 repository 指向本仓库
- **两个 npm 包名不要改**:`pi-working-activity` 被 pi 用户直接安装,`dsh-working-activity` 被 dsh-cc-tui 依赖
