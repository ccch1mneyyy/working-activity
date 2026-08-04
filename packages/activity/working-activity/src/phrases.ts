/**
 * Copy pools for the working-activity status line: short, colloquial, playful
 * Chinese fragments with deadpan English one-liners mixed in, matching the
 * pi-working-activity tone. Everything here is pure data + pure pickers.
 * @module @deepseek-ai/dsh-working-activity/phrases
 */

/** A pool of copy fragments. */
export type PhrasePool = readonly string[]

/** Pick one random entry; repeated draws avoid the previous entry when possible. */
export function pickPhrase(entries: PhrasePool, previous?: string): string {
  if (entries.length === 0) throw new Error('pickPhrase() requires a non-empty pool')
  if (entries.length === 1) return entries[0] as string
  let next = entries[Math.floor(Math.random() * entries.length)] as string
  let guard = 0
  while (next === previous && guard++ < 8) {
    next = entries[Math.floor(Math.random() * entries.length)] as string
  }
  return next
}

/** Thinking phrases while the model works without a tool. */
export const THINKING_PHRASES: readonly string[] = [
  '嗯…让我捋捋', '盘一下盘一下', '大脑转起来了', '思考.gif', '给我一秒', '脑子在冒烟',
  '想呢想呢', '别催别催', '啾，让我想想', '让我琢磨下', '嗯…等一下哦', '正在盘逻辑',
  '小脑瓜动一下', '嗯？哦…', '让我理理', '翻翻脑子', '回想中', '等一下下', '让我嗅嗅',
  '脑内风暴中', '嗯…让我品品', '滴滴滴思考中', '稍等，在想', '盘明白了么', '挠头…',
  '让子弹飞一会', '让我脑补一下', '加载中', '你说 我在听', '噢…是这样', '让我嚼一嚼',
  '嗯…有点意思', '搓搓手想想', '等下，在想', '让我康康', '想好了告诉你', '脑子转圈圈',
  '嗯…让我反应下', '等下下嘛', '思路加载中', '琢磨中', '嗯…让我拆一下', '盘，都可以盘',
  '让我嗅探一下', '脑内跑火车', '嗯…让我缓一下', '滴滴，想呢', '思索.jpg', '嗯…有点东西',
  '让我品', '小跑一下思路', '等下，有画面了', '让我咀嚼', '嗯…发会儿呆', '思考泡泡',
  '脑电波传输中', '嗯…转转', '等下，盘好了', '让我回味', '滴滴滴', '思考的鱼',
  '嗯…让我摸一下', '脑子在煮咖啡', '等下，我打个腹稿', '嗯…重启一下', '让我挠墙',
  '嗯，来了来了', '脑子冒泡泡', '嗯…有点烫', '思考猫猫', '让我咕噜一下', '嗯…盘它',
  '等下，我闪个思路', '脑子在蹦迪', '嗯…', '让我想想', '盘一下', '啾', 'lol', 'hm', 'oh',
  'ok', 'um', 'heh', 'uh', 'nah', 'mm', 'wow', 'nice', 'rgrg', 'okk', 'hhh', 'emm', 'emmm',
  'CPU烧了', '让我打个log看看', '先跑一下试试', '定位一下', '排查一下', '看看日志',
  'loading 99%', '让我捋一下逻辑',
]

/** Tiered phrases when thinking runs long (elapsed >= threshold). */
export const THINKING_TIERS: readonly {
  /** Minimum thinking ms for this tier. */
  readonly atMs: number
  readonly pool: readonly string[]
}[] = [
  { atMs: 30_000, pool: ['嗯，让我细想想', '30秒了，还在盘', '等下，快好了', '别急，就快出结果了', '让我再捋一捋', '嗯…思路没断', '30秒，快了', '等等，有眉目了', '有点久…', '转圈圈…', '马上马上', '快了快了', '别走，就快好了', '在盘了呢', '还在定位', '快复现了'] },
  { atMs: 60_000, pool: ['1分钟，还在想', '这题有点东西', '让我再钻研下', '嗯…问题不简单', '1分钟，别走开', '盘得有点深', '脑细胞在燃烧', '等等，快盘清了', '还在努力…', '这个有点绕…', '烧脑中…', '别走，快了', '一分钟了，再等等', '这题值得盘', '还在排查', '这个有点复杂'] },
  { atMs: 300_000, pool: ['5分钟，大工程', '这把我得认真', '确实有点绕', '等等，我在修仙', '快好了，真的', '盘了一大圈', '别慌，在收尾', '给我一首歌的时间', '还没放弃…', '这题真的硬…', '我给跪了…', '憋大招中', '5分钟了，等值了', '快了，真快了', '这个需求很简单', '能跑就别动'] },
]

/** Phrases shown while waiting for the first streamed token. */
export const WAITING_PHRASES: readonly string[] = [
  '呼叫模型…', '模型在路上了', '等它开口…', '稍等，它有点慢', '模型加载中', '嗯…等它一下',
  '它在组织语言', '等等我嘛', '模型醒了么', '等它伸懒腰', '它打了个哈欠', '模型：来了来了',
  '等它出字', '别急，在等', '它磨蹭呢', '模型说等一下', '等它滴一声', '模型在咕噜',
  '等它反应过来', '嗯…等它', '模型在喝水', '它说再等一下', '等它喘口气', '模型：快了快了',
  '别急别急', '来了来了', '等它跑完', '还在排队', '马上出结果', '等它热身', '模型在酝酿',
  '它翻了个身', '模型：马上', '等它开机', '它卡了一下', '模型在冥想', '等它眨个眼',
  '它说稍等', '模型在查资料', '等它缓一缓', '模型在数数', '等它回神', '它终于动了',
]

/** Tool-name patterns mapped to playful action verbs. */
export const ACTION_MAP: readonly {
  readonly test: RegExp
  readonly actions: readonly string[]
}[] = [
  { test: /^(read|read_file|cat)$/i, actions: ['翻翻文档', '让我康康', '读一下', '看一眼', '翻阅中', '读读看', '翻翻', '看看', '瞄一眼', '康康', '翻一页'] },
  { test: /^(write|write_file|create_file)$/i, actions: ['写写写', '下笔中', '码字呢', '写一段', '记录一下', '写一下', '记下来', '落笔', '开写', '存个文件'] },
  { test: /^(edit|edit_file|str_replace|apply_patch|search_replace)$/i, actions: ['改改', '修修补补', '润色一下', '编辑中', '调整调整', '改一改', '修一下', '改两行', '调一下', '补一刀'] },
  { test: /^(bash|shell|run|exec|powershell|cmd)$/i, actions: ['跑个命令', 'bash一下', '敲敲指令', '命令行走起', '执行一下', '敲回车', '跑一下', '敲个命令', '跑命令', '使唤终端'] },
  { test: /^(grep|rg|search|search_in_files)$/i, actions: ['搜搜东西', 'grep 一下', '找找匹配', '关键词走你', '过滤中', '搜搜看', '搜一下', '找找', '扫一眼', '挖一挖'] },
  { test: /^(find|glob)$/i, actions: ['找找文件', '找一下', '寻宝中', '找啊找', '文件在哪', '查找中', '搜搜目录'] },
  { test: /^(ls|list_dir|list)$/i, actions: ['列个清单', '看看目录', 'ls 看一眼', '瞄一下文件', '目录走起', '列出来', '列一下', '瞟一眼', '翻翻'] },
  { test: /^(web_search|search_web|brave|tavily|exa)$/i, actions: ['网上搜搜', '搜一下', '网络冲浪', '查找资料', '上网瞄瞄', '上网搜搜', '查查', '搜一圈', '打听一下'] },
  { test: /^(web_fetch|fetch|fetch_content)$/i, actions: ['抓个页面', '拉取一下', 'fetch 中', '扒拉网页', '取点内容', '抓取资料', '扒一下', '打开看看'] },
  { test: /^(mcp)/i, actions: ['mcp 连一下', '调个服务', '接个工具', 'mcp 走你', '调接口', '连一下', '喊外援', '接一下'] },
  { test: /^(subagent|agent|task)$/i, actions: ['派个小弟', '小助手出动', '支个 agent', '让小弟跑腿', '代理干活', '子任务起飞', '分个任务', '交给小弟', '派出去'] },
  { test: /^(todo|manage_todo_list)$/i, actions: ['列个待办', '写个清单', 'todo 安排', '记一下', '待办走起', '清单一下', '记个待办', '打个勾'] },
  { test: /^(browser|chrome|playwright)/i, actions: ['开个浏览器', '浏览器跑腿', '网页操作', '浏览器干活', '开网页', '点点页面'] },
  { test: /^(git|gh|github)/i, actions: ['git 操作', '提交一下', '版本控制', 'git 走你', '提交代码', '管个仓库', 'git 一下'] },
  { test: /^(ask_user_question|ask)$/i, actions: ['提问中', '问一个问题', 'ask 一下', '请教一下', '问问看', '问你个事', '确认一下'] },
  { test: /^(goal_complete|goal_blocked)$/i, actions: ['定个目标', '设定目标', 'goal 设置', '目标走起', '规划一下', '更新进度'] },
  { test: /^(todo_write)$/i, actions: ['记个待办', '划个清单', '打个勾'] },
]

/** Fallback verbs for unknown tools. */
export const FALLBACK_ACTIONS: readonly string[] = ['干活', '调用', '整一下', '搞一下', '动动手', '备选方案', '换条路']

/** Tool failure phrases, replacing a bare ✗. */
export const FAIL_PHRASES: readonly string[] = [
  '翻车了', '哎呀', '掉了', '没跑通', '摔了一跤', '再来一次', '这不对', '出岔子了', '不灵了',
  '坏消息', '权限不对？', '连不上？', '404了', '不太对', '有点问题', '再看看', '没接住', '漏了',
  '我本地能跑啊', '昨天还能跑', '重启试试', '清一下缓存', '删了重装', '你刷新一下', '环境问题',
  '少了个分号', '拼错了', '没保存', '又不是不能用', '绷不住了', '难绷', '卒', '裂开',
  '血压上来了', '缓存害我', '再给我一次机会', '这波大意了', '手滑', '回滚重来', '换个姿势',
]

/** Turn-completion phrases. */
export const DONE_PHRASES: readonly string[] = [
  '交差！', '搞定，下一个', '好了，收工', '完成啦', '交作业', '结束，完美', '完工咯', '搞定啦',
  '任务完成', '好了，歇会儿', '搞定', '收工', '妥了', '完事', '交差', '齐活', '拿下', '收工！',
  '搞定收工', '收！', '完事！', '下一题', '能跑！', '没报错', '过了', '上线！', '稳了', '6',
  '完工！', '完美收场', '这波不亏', '一次过', '收工摸鱼', '漂亮', '全绿', '干净利落',
  '手到擒来', '水到渠成', '下班！', '歇口气', '交接完成', '工单关闭', '收尾完毕',
]

/** Night-owl phrases mixed in between 00:00 and 06:00 local time. */
export const NIGHT_PHRASES: readonly string[] = [
  '修仙中…', '深夜冒泡', '你也是夜猫子呀', '月亮不睡我不睡', '夜里脑子慢，谅解', '晚安？还早呢',
  '深夜盘东西', '熬夜冠军上线', '困了，但能行', '过了零点照样肝', '夜猫子出没', '深夜档营业',
  '星星都睡了', '凌晨还在盘', '深夜上线', '凌晨部署', '通宵了',
]

/** Common git tool names / bash commands containing `git `. */
export const GIT_TOOL_RE = /^(?:git|git_diff|git_commit|git_push|git_pull|git_checkout|git_branch|git_merge|git_rebase|github|gh)$/i

/** Detect the 00:00–06:00 night window (local time). */
export function isNight(hour: number): boolean {
  return hour >= 0 && hour < 6
}

/**
 * Pick a thinking phrase appropriate for the elapsed thinking time.
 * @param elapsedMs - Milliseconds spent thinking in the current phase.
 * @param previous - Previously shown phrase, to avoid repeats.
 * @param night - Mix night-owl copy into the pool.
 */
export function thinkingPhrase(elapsedMs: number, previous?: string, night = false): string {
  let pool: readonly string[] = THINKING_PHRASES
  for (const tier of THINKING_TIERS) {
    if (elapsedMs >= tier.atMs) {
      pool = tier.pool
      break
    }
  }
  if (night && pool === THINKING_PHRASES) {
    return pickPhrase([...pool, ...NIGHT_PHRASES], previous)
  }
  return pickPhrase(pool, previous)
}

/**
 * Map a tool name to a playful action verb.
 * @param toolName - Registry tool name (unqualified).
 * @param custom - Exact-name custom action pools, matched case-insensitively.
 */
export function actionFor(toolName: string, custom?: Readonly<Record<string, readonly string[]>>): string {
  const normalized = toolName.trim().toLowerCase()
  const customPool = custom?.[normalized]
  if (customPool !== undefined && customPool.length > 0) return pickPhrase(customPool)
  for (const { test, actions } of ACTION_MAP) {
    if (test.test(normalized)) return pickPhrase(actions)
  }
  return pickPhrase(FALLBACK_ACTIONS)
}

/** Whether a tool is a git operation (name match, or a shell command containing `git `). */
export function isGitTool(toolName: string, args?: Readonly<Record<string, unknown>>): boolean {
  if (GIT_TOOL_RE.test(toolName.trim())) return true
  if (/^(?:bash|shell|cmd|powershell|pwsh)$/i.test(toolName.trim())) {
    const command = args?.command ?? args?.cmdline
    return typeof command === 'string' && /\bgit\s+/.test(command)
  }
  return false
}

/** Format milliseconds as a compact human duration (`1m23s`). */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return '0s'
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}
