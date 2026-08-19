/**
 * Copy pools for the working-activity status line: short, colloquial, playful
 * fragments with a "live person" vibe, in both Chinese and English. The zh
 * pools are the original copy; the en pools mirror the same tone — deadpan,
 * meme-y, occasionally unhinged. Everything here is pure data + pure pickers;
 * the active language is resolved per pick via `langNow()`.
 * @module @deepseek-ai/dsh-working-activity/phrases
 */

import { langNow } from './lang.js'

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

// ── zh pools (original copy) ─────────────────────────────────────────────

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
  '抓个包看看', 'loading 99%', '让我捋一下逻辑', '嗯…让我偷想一下',
]

/** Tiered phrases when thinking runs long (elapsed >= threshold). */
export const THINKING_TIERS: readonly {
  /** Minimum thinking ms for this tier. */
  readonly atMs: number
  readonly pool: readonly string[]
}[] = [
  { atMs: 30_000, pool: ['嗯，让我细想想', '30秒了，还在盘', '等下，快好了', '别急，就快出结果了', '让我再捋一捋', '嗯…思路没断', '30秒，快了', '等等，有眉目了', '有点久…', '转圈圈…', '马上马上', '快了快了', '别走，就快好了', '在盘了呢', '还在定位', '快复现了'] },
  { atMs: 60_000, pool: ['1分钟，还在想', '这题有点东西', '让我再钻研下', '嗯…问题不简单', '1分钟，别走开', '盘得有点深', '脑细胞在燃烧', '等等，快盘清了', '还在努力…', '这个有点绕…', '烧脑中…', '别走，快了', '一分钟了，再等等', '这题值得盘', '还在排查', '这个有点复杂'] },
  { atMs: 300_000, pool: ['5分钟，大工程', '这把我得认真', '确实有点绕', '等等，我在修仙', '快好了，真的', '盘了一大圈', '别慌，在收尾', '给我一首歌的时间', '还没放弃…', '这题真的硬…', '我给跪了…', '憋大招中', '5分钟了，等值了', '快了，真快了', '这个需求很简单', '能跑就别动', 'PM说这个很急', '先上线再说'] },
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
  { test: /^(read|read_file|cat)$/i, actions: ['翻翻文档', '让我康康', '读一下', '看一眼', '翻阅中', '读读看', '翻翻', '看看', '瞄一眼', '康康', '翻一页', '翻翻看'] },
  { test: /^(write|write_file|create_file)$/i, actions: ['写写写', '下笔中', '码字呢', '写一段', '记录一下', '改改再写', '写一下', '记下来', '落笔', '开写', '存个文件'] },
  { test: /^(edit|edit_file|str_replace|apply_patch|search_replace)$/i, actions: ['改改', '修修补补', '润色一下', '编辑中', '调整调整', '改一改', '修一下', '改两行', '调一下', '补一刀', '动动手指'] },
  { test: /^(bash|shell|run|exec|powershell|cmd)$/i, actions: ['跑个命令', 'bash一下', '敲敲指令', '命令行走起', '执行一下', '敲回车', '跑一下', '敲个命令', '跑命令', '使唤终端', '跑个腿'] },
  { test: /^(grep|rg|search|search_in_files|ffgrep)$/i, actions: ['搜搜东西', 'grep 一下', '找找匹配', '关键词走你', '过滤中', '搜搜看', '搜搜', '找找', '搜一下', '扫一眼', '挖一挖'] },
  { test: /^(find|glob|fffind)$/i, actions: ['找找文件', '找一下', '寻宝中', '找啊找', '文件在哪', '查找中', '摸一下', '搜搜目录'] },
  { test: /^(ls|list_dir|list)$/i, actions: ['列个清单', '看看目录', 'ls 看一眼', '瞄一下文件', '目录走起', '列出来', '列一下', '瞟一眼', '翻翻'] },
  { test: /^(web_search|search_web|brave|tavily|exa|search-layer)$/i, actions: ['网上搜搜', '搜一下', '网络冲浪', '查找资料', '上网瞄瞄', '上网搜搜', '查查', '搜一圈', '打听一下'] },
  { test: /^(web_fetch|fetch|fetch_content|get_search_content|batch_web_fetch)$/i, actions: ['抓个页面', '拉取一下', 'fetch 中', '扒拉网页', '取点内容', '抓取资料', '扒一下', '拉一下', '打开看看'] },
  { test: /^(mcp)/i, actions: ['mcp 连一下', '调个服务', '接个工具', 'mcp 走你', '调接口', '连一下', '调个工具', '喊外援', '接一下', '问问插件'] },
  { test: /^(recall)$/i, actions: ['回想一下', '回忆中', '提取记忆', '想起啥了', '记起来', '翻翻记忆', '想想之前'] },
  { test: /^(subagent|agent|task)$/i, actions: ['派个小弟', '小助手出动', '支个 agent', '让小弟跑腿', '代理干活', '子任务起飞', '分个任务', '交给小弟', '派出去'] },
  { test: /^(todo|manage_todo_list)$/i, actions: ['列个待办', '写个清单', 'todo 安排', '记一下', '待办走起', '清单一下', '记个待办', '划个清单', '打个勾'] },
  { test: /^(browser|chrome|playwright|agent_browser|chrome_devtools)/i, actions: ['开个浏览器', '浏览器跑腿', '网页操作', '浏览器干活', '开网页', '开浏览器', '点点页面', '开个页面'] },
  { test: /^(git|gh|github)/i, actions: ['git 操作', '提交一下', '版本控制', 'git 走你', '提交代码', '管个仓库', 'git 一下'] },
  { test: /^(notebook|jupyter)/i, actions: ['笔记本记下', '写个笔记', '记个笔记', '本子写写', '记录东西', '跑个 cell'] },
  { test: /^(ctx_execute|ctx_execute_file|ctx_batch_execute)$/i, actions: ['上下文执行', '跑上下文', 'ctx 执行', '执行一下', '上下文操作', '运行中', '跑段代码', '算一下', '后台跑一下'] },
  { test: /^(ctx_search|ctx_index|ctx_fetch_and_index)$/i, actions: ['搜上下文', '上下文搜搜', 'ctx 查找', '找找上下文', '搜一下历史', '找找记录', '翻知识库', '查索引', '搜一下笔记'] },
  { test: /^(ctx_stats|ctx_doctor|ctx_upgrade|ctx_purge|ctx_insight)$/i, actions: ['统计一下', '上下文统计', 'ctx 状态', '看个状态', '统计中', '看看数目', '看看状态', '诊断一下', '查一下'] },
  { test: /^(ask_user_question|ask)$/i, actions: ['提问中', '问一个问题', 'ask 一下', '请教一下', '问问看', '问一问', '问你个事', '确认一下', '问问你'] },
  { test: /^(goal_complete|goal_blocked)$/i, actions: ['定个目标', '设定目标', 'goal 设置', '目标走起', '规划一下', '目标确认', '标记目标', '更新进度', '打个勾'] },
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
  '重试一次',
]

/** Turn-completion phrases. */
export const DONE_PHRASES: readonly string[] = [
  '交差！', '搞定，下一个', '好了，收工', '完成啦', '交作业', '结束，完美', '完工咯', '搞定啦',
  '任务完成', '好了，歇会儿', '搞定', '收工', '妥了', '完事', '交差', '齐活', '拿下', '收工！',
  '搞定收工', '收！', '完事！', '下一题', '能跑！', '没报错', '过了', '上线！', '稳了', '6',
  '完工！', '完美收场', '这波不亏', '一次过', '收工摸鱼', '漂亮', '全绿', '干净利落',
  '手到擒来', '水到渠成', '下班！', '歇口气', '交接完成', '工单关闭', '收尾完毕',
  '在我机器上能跑',
]

/** Night-owl phrases mixed in between 00:00 and 06:00 local time. */
export const NIGHT_PHRASES: readonly string[] = [
  '修仙中…', '深夜冒泡', '你也是夜猫子呀', '月亮不睡我不睡', '夜里脑子慢，谅解', '晚安？还早呢',
  '深夜盘东西', '熬夜冠军上线', '困了，但能行', '过了零点照样肝', '夜猫子出没', '深夜档营业',
  '星星都睡了', '凌晨还在盘', '深夜上线', '凌晨部署', '通宵了',
]

// ── en pools (same vibe, different language) ─────────────────────────────

/** English thinking phrases — casual, meme-y, alive. */
export const EN_THINKING_PHRASES: readonly string[] = [
  'Thinking…', 'Pondering…', 'Mulling it over', 'Brain.exe running', 'Loading thoughts…',
  'Deep in thought', 'Hmm…', 'Cogitating', 'Reasoning intensifies', 'On it', 'Working it out',
  'Connecting the dots', 'Crunching ideas', 'Chewing on it', 'Neurons firing',
  'Reticulating splines', 'Thinking cap on', 'Give me a sec', 'Halfway there',
  'Still thinking', 'Turning the crank', 'Ideas brewing', 'Thoughts loading…',
  'Calculating life choices', 'Let me cook', 'Cooking…', 'Brain cells: engaged',
  'Thinking thoughts', 'Mmm…', 'Processing…', 'Almost', 'Just vibing with the problem',
  'Mystery math happening', 'Gathering thoughts', 'In the zone', 'Distracted by a pigeon',
  'Have you tried thinking harder?', 'Summoning wisdom', 'rrrr', 'um', 'ok ok', 'wait…',
]

/** English tiered phrases when thinking runs long. */
export const EN_THINKING_TIERS: readonly {
  readonly atMs: number
  readonly pool: readonly string[]
}[] = [
  { atMs: 30_000, pool: ['30s in, still thinking', "This one's a thinker", 'Deeper than it looks', 'Getting warmer…', 'Still cooking', 'Brain on overtime', 'Not done yet', 'Almost there…', 'The gears are turning', 'One more sec', 'Loading 99%… again'] },
  { atMs: 60_000, pool: ['1m in, still going', "This is a tough one", 'Full brain power', '1m, stay with me', 'Still grinding', 'Brain at full tilt', 'Almost…', 'Taking the scenic route', "It's a marathon, not a sprint", 'The plot thickens'] },
  { atMs: 300_000, pool: ['5m in, big brain energy', 'This is a marathon', 'Seriously deep now', 'Meditating on it', 'Slow and steady', 'Getting there', 'Worth the wait', 'One song later…', '5 minutes of pure thought', "I've seen things", 'Ascending to another plane of thought'] },
]

/** English phrases while waiting for the first token. */
export const EN_WAITING_PHRASES: readonly string[] = [
  'Pinging the model…', 'Model inbound…', 'Waiting on the muse', 'Wake up, model',
  "It's warming up", 'Model: almost there', 'Holding for a token…', 'Brewing a response…',
  'Model is stretching', 'Just a sec', 'One moment, please', 'Loading…', 'Connecting…',
  'Model said "be right back"', "It's yawning", 'First token incoming…', 'Hmm, still waiting',
  'Model is putting on its glasses', 'Tick tock…', 'Summoning tokens…', 'Patiently waiting',
  'Model is thinking of a hello', 'Booting brain…', 'Is it plugged in?', 'Gently poking the model',
  'Waiting for the magic words…', 'A wild token appears… soon', 'Reticulating the request',
]

/** English tool-name → action verbs. */
export const EN_ACTION_MAP: readonly {
  readonly test: RegExp
  readonly actions: readonly string[]
}[] = [
  { test: /^(read|read_file|cat)$/i, actions: ['Reading', 'Peeking at', 'Snooping through', 'Skimming', 'Checking out', 'Eyes on', 'Giving it a read'] },
  { test: /^(write|write_file|create_file)$/i, actions: ['Writing', 'Typing it out', 'Crafting', 'Saving progress', 'Pen to paper (virtually)', 'Putting words down'] },
  { test: /^(edit|edit_file|str_replace|apply_patch|search_replace)$/i, actions: ['Editing', 'Patching', 'Tweaking', 'Polishing', 'Fixing a typo (probably)', 'Adjusting', 'Giving it a touch-up'] },
  { test: /^(bash|shell|run|exec|powershell|cmd)$/i, actions: ['Running', 'Executing', 'Shelling out', 'Firing a command', 'Terminal time', 'Doing terminal things', 'Making the computer do stuff'] },
  { test: /^(grep|rg|search|search_in_files)$/i, actions: ['Searching', 'Grepping', 'Hunting for matches', 'Looking for a needle', 'Sifting through', 'Diving into the haystack'] },
  { test: /^(find|glob)$/i, actions: ['Finding files', 'Looking for files', 'File hunt', 'Hunting down a path'] },
  { test: /^(ls|list_dir|list)$/i, actions: ['Listing', 'Peeking at the dir', "What's in here?", 'Taking inventory'] },
  { test: /^(web_search|search_web|brave|tavily|exa)$/i, actions: ['Searching the web', 'Googling', 'Researching', 'Web diving (the safe kind)', 'Looking it up'] },
  { test: /^(web_fetch|fetch|fetch_content)$/i, actions: ['Fetching a page', 'Grabbing content', 'Pulling the page', 'Downloading knowledge'] },
  { test: /^(mcp)/i, actions: ['Calling MCP', 'Hitting a service', 'MCP time', 'Talking to a server'] },
  { test: /^(recall)$/i, actions: ['Recalling', 'Digging through memory', 'Remembering things', 'Checking the archives'] },
  { test: /^(subagent|agent|task)$/i, actions: ['Delegating', 'Sending a subagent', 'Calling a helper', 'Outsourcing', 'Drafting a minion'] },
  { test: /^(todo|manage_todo_list)$/i, actions: ['Updating todos', 'Checking the list', 'Todo time', 'Adding a checkbox'] },
  { test: /^(browser|chrome|playwright)/i, actions: ['Driving the browser', 'Clicking around', 'Browsing', 'Puppeteering a browser'] },
  { test: /^(git|gh|github)/i, actions: ['Git-ing', 'Committing', 'Version control dance', 'Git things', 'Saving the timeline'] },
  { test: /^(notebook|jupyter)/i, actions: ['Writing a notebook', 'Running a cell', 'Notebook time', 'Jotting it down'] },
  { test: /^(ctx_execute|ctx_execute_file|ctx_batch_execute)$/i, actions: ['Running context', 'Executing in context', 'Context ops', 'Running a snippet'] },
  { test: /^(ctx_search|ctx_index|ctx_fetch_and_index)$/i, actions: ['Searching context', 'Looking through history', 'Indexing notes', 'Digging the knowledge base'] },
  { test: /^(ctx_stats|ctx_doctor|ctx_upgrade|ctx_purge|ctx_insight)$/i, actions: ['Context stats', 'Checking status', 'Diagnosing', 'Looking at numbers'] },
  { test: /^(ask_user_question|ask)$/i, actions: ['Asking you', 'Checking with you', 'Quick question', 'Pinging the human'] },
  { test: /^(goal_complete|goal_blocked)$/i, actions: ['Updating goals', 'Tracking progress', 'Checking the objective'] },
  { test: /^(todo_write)$/i, actions: ['Writing todos', 'Making a list', 'Adding a checkbox'] },
]

/** English fallback verbs for unknown tools. */
export const EN_FALLBACK_ACTIONS: readonly string[] = [
  'Working on it', 'Doing a thing', 'Handling it', 'Taking care of it',
  'Something productive', 'Figuring it out', 'Winging it',
]

/** English tool failure phrases. */
export const EN_FAIL_PHRASES: readonly string[] = [
  'That failed', 'Oops', 'No dice', "Didn't work", 'Broke it (it was already broken)',
  "It's not a bug, it's a feature", '404: success not found', 'Retry?', "Hmm, that's odd",
  'RIP', 'Sigh…', 'One more time', 'Classic', 'Works on my machine',
  'Have you tried turning it off and on?', 'Someone unplugged the internet',
  'Out of ideas, trying again', 'The computer said no', 'Error: user error', 'So close…',
]

/** English turn-completion phrases. */
export const EN_DONE_PHRASES: readonly string[] = [
  'Done!', 'All set', 'Finished', "That's that", 'Done and dusted', 'Mission complete',
  'Sorted', 'Wrapped up', 'Ship it!', 'Clean run', 'Nice', 'One and done', 'All green',
  'Knocked out', 'Closed out', 'Task: destroyed', 'EZ', 'GG', 'Another one bites the dust',
  'Victory lap', 'Boom', 'Tada!', 'Smooth sailing', 'No notes', 'Crushed it',
]

/** English night-owl phrases. */
export const EN_NIGHT_PHRASES: readonly string[] = [
  'Night owl shift', 'Burning midnight oil', 'Past midnight, still going', "The moon's out",
  'Night grind', 'Up late', 'Almost dawn', '2AM thoughts', 'Red-eye shift',
  'Who needs sleep anyway?', 'The stars are my witness',
]

// ── 彩蛋池 (easter eggs, pi extension parity) ────────────────────────────

/** Rare easter-egg phrases (1/150 draw, pi `RARE_PHRASES`). */
export const RARE_PHRASES: readonly string[] = [
  'SSR！稀有彩蛋', 'UR 掉落', '金色传说！', '爆装备了', 'ssr 彩蛋出现', 'lol 中奖了', '这把 ez',
  'GG！闪耀', '稀有掉落确认', 'wow，出橙了', '彩蛋砸脸', '我承认，被帅到了', '天选时刻',
  '五星好评掉落', '你发现了隐藏款', '触发隐藏对话', '稀有帧', '恭喜，这是稀有货', 'lol 你赚了',
  'gg ez 彩蛋', '欧气爆棚', '这把不亏', '真·金色传说', '彩蛋蹦出来了', 'sssr 隐藏', '你解锁了稀有',
  'SSR！', 'UR！', '金色传说', 'gg', 'ez', '暴击了', 'wink ~', '你发现我了', '欧皇降临',
  '隐藏款！', '稀有度 MAX', '一次过！', '没bug', '完美运行', '测试全绿', '这波在大气层',
]

/** English rare easter-egg phrases. */
export const EN_RARE_PHRASES: readonly string[] = [
  'SSR! Rare egg', 'Legendary drop!', 'Golden loot', 'You found the hidden one',
  'Secret phrase unlocked', 'Rarity MAX', 'Wink ~', 'You caught me', 'GG, shiny!',
  'This is the easter egg', 'Five-star drop', 'Ez win', 'Gacha gods smiled on you',
]

/** Chance of drawing a rare phrase per thinking rotation. */
export const RARE_CHANCE = 1 / 150

/** Weekend-greeting phrases (once per turn on Sat/Sun). */
export const WEEKEND_PHRASES: readonly string[] = [
  '周末摸鱼中', '周末也在！', '放假也陪你', '周末不关机', '周末偷着盘', '周末也在卷？', '卷王你好',
  '还在加班…', '周末限定皮肤', '周六也营业', '周日也接单', '周末不放假', '摸鱼限定版', '周末模式 ON',
  '周末hotfix', '周末在修bug', '周末上线',
]

/** English weekend greetings. */
export const EN_WEEKEND_PHRASES: readonly string[] = [
  'Weekend mode ON', 'Working on a weekend?', 'Saturday shift', 'Sunday grind',
  'The weekend never sleeps', 'Casual Saturday', 'Weekend warrior', 'Still here, it\'s the weekend',
]

/** Whether `date` falls on a weekend. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/** Holiday copy keyed by `MM-DD` (zh). */
export const HOLIDAY_PHRASES: Readonly<Record<string, readonly string[]>> = {
  '01-01': ['新年快乐！', '元旦快乐', '新的一年，新的 bug', '新年第一盘', '开工大吉', '新年第一行代码'],
  '02-14': ['情人节也在敲代码', '代码才是真爱', '今天不约会？', 'bug 也是 love', '键盘就是玫瑰'],
  '04-01': ['愚人节快乐', '这个 bug 是假的吧', '小心假报错', '今天谁骗我', '❌ 骗你的，没报错'],
  '05-01': ['劳动节还在卷', '劳动最光荣', '打工人打工魂', '卷王放假了？'],
  '06-01': ['儿童节快乐', '谁还不是个宝宝', '今天代码要写得可爱', '🍭 宝宝模式'],
  '10-31': ['万圣节快乐', '不给糖就捣蛋', '🎃 南瓜来了', '👻 代码也会吓人'],
  '12-24': ['平安夜快乐', '圣诞老人来了', '🎄 今晚写代码有礼物', '平安夜也在盘'],
  '12-25': ['圣诞快乐', 'Merry Christmas', '🎅 圣诞也陪你', '圣诞限定彩蛋', '🎄 麋鹿送代码'],
  '12-31': ['跨年夜', '新年倒计时', '今年最后一盘', '🍾 准备跨年', '明年见！'],
}

/** English holiday copy keyed by `MM-DD`. */
export const EN_HOLIDAY_PHRASES: Readonly<Record<string, readonly string[]>> = {
  '01-01': ['Happy New Year!', 'New year, new bugs', 'First grind of the year'],
  '02-14': ['Valentine\'s at the keyboard', 'Code is my true love', 'No date tonight?'],
  '04-01': ['April Fools!', 'That bug is fake, right?', 'Careful of fake errors'],
  '05-01': ['Labor Day grind', 'Workers of the world', 'Still shipping on a holiday'],
  '06-01': ['Happy Children\'s Day', 'We\'re all babies inside', 'Write cute code today'],
  '10-31': ['Happy Halloween', 'Trick or treat', '🎃 Pumpkins and code'],
  '12-24': ['Merry Christmas Eve', 'Santa\'s coming', '🎄 Gifts for coders too'],
  '12-25': ['Merry Christmas', '🎅 Santa grinds too', 'Christmas egg unlocked', '🎄 Code under the tree'],
  '12-31': ['New Year\'s Eve', 'Countdown time', 'Last grind of the year', '🍾 See you next year!'],
}

/** Lunar New Year copy (approximated by Gregorian dates, extended yearly). */
export const LUNAR_NEW_YEAR_PHRASES: readonly string[] = [
  '🧧 春节快乐！', '过年还在写代码', '红包拿来', '新春快乐', '拜年了', '过年好', '代码也拜个年',
  '🐉 龙年大吉', '年夜饭写代码', '年味盘起来',
]

/** English Lunar New Year copy. */
export const EN_LUNAR_NEW_YEAR_PHRASES: readonly string[] = [
  '🧧 Happy Lunar New Year!', 'Coding through the New Year', 'Red packets please',
  'Gong Xi Fa Cai', 'New Year grind',
]

/** Gregorian dates marked as Lunar New Year (2025–2027, extend yearly). */
export const LUNAR_NEW_YEAR_DAYS: Readonly<Record<string, true>> = {
  '2025-01-29': true, '2025-01-30': true, '2025-01-31': true, '2025-02-01': true, '2025-02-02': true, '2025-02-03': true, '2025-02-04': true,
  '2026-02-17': true, '2026-02-18': true, '2026-02-19': true, '2026-02-20': true, '2026-02-21': true, '2026-02-22': true, '2026-02-23': true,
  '2027-02-06': true, '2027-02-07': true, '2027-02-08': true, '2027-02-09': true, '2027-02-10': true, '2027-02-11': true, '2027-02-12': true,
}

/** Phrases shown after the user interrupts and the model resumes. */
export const CONTINUE_PHRASES: readonly string[] = [
  '再来，again！', '接着盘', '继续整', 'again！走起', '接着刚才的', '续上，继续', '再续一秒',
  '继续继续', '继续…', '好，接着来…', 'again', '没断片', '在修了在修了', '马上好', '还差一点', '快好了',
]

/** English post-interruption phrases. */
export const EN_CONTINUE_PHRASES: readonly string[] = [
  'Again! Round two', 'Back at it', 'Continuing where we left off', 'Resuming…', 'One more time',
  'No memory loss here', 'Fixing it, fixing it', 'Almost there', 'Round two: electric boogaloo',
]

/** Phrases after a successful context compaction. */
export const COMPACT_PHRASES: readonly string[] = [
  '压缩了一下', '瘦了个身', '腾出地方了', '整理了下记忆', '减负成功', '释放了一波', '清爽多了',
  '瘦身完毕', '好多了', '整理好了', '清了一下缓存', '重启了一下', 'GC了一下', '释放了一波内存',
]

/** English post-compaction phrases. */
export const EN_COMPACT_PHRASES: readonly string[] = [
  'Compacted', 'Slimmed down', 'Made room', 'Memory tidied', 'Lighter now', 'All tidy',
  'Cleared the cache', 'GC\'d', 'Fresh and clean',
]

/** Urgent phrases when compaction is forced by overflow. */
export const OVERFLOW_PHRASES: readonly string[] = [
  '装不下了', '太长了', '超载了', '爆了', '兜不住了',
]

/** English overflow phrases. */
export const EN_OVERFLOW_PHRASES: readonly string[] = [
  "It's full", 'Too long', 'Overloaded', 'Overflow!', "Can't hold it all",
]

/** Phrases when retrying after a forced compaction. */
export const COMPACT_RETRY_PHRASES: readonly string[] = [
  '马上重试', '继续盘', '接着来', '再来', '续上',
]

/** English compact-retry phrases. */
export const EN_COMPACT_RETRY_PHRASES: readonly string[] = [
  'Retrying now', 'Carrying on', 'Round three', 'Again', 'Picking it back up',
]

/** Model-switch quips keyed by a lowercase substring of the model id. */
export const MODEL_QUIPS: Readonly<Record<string, readonly string[]>> = {
  claude: ['Claude 来了', '换 Claude 了', '让 Claude 试试', 'Claude 出战', '克劳德上线'],
  gpt: ['GPT 来了', '换个 GPT', 'GPT 出战', 'GPT 值班', 'GPT 上班'],
  grok: ['Grok 来了', 'Grok 出战', 'Grok 硬核', 'Grok 上班', '火星选手'],
  gemini: ['Gemini 来了', 'Gemini 出战', 'Google 选手', '双子星', 'G 家选手'],
  deepseek: ['DeepSeek 来了', 'DeepSeek 出战', '国产选手', '深度求索', 'DS 上班'],
  haiku: ['Haiku 快枪手', 'Haiku 来了', '短平快模式', '俳句选手', 'Haiku 轻快'],
  sonnet: ['Sonnet 来了', 'Sonnet 出战', '文采担当', '十四行诗', 'Sonnet 文豪'],
  opus: ['Opus 来了', 'Opus 出战', '放大招', '巨作登场', 'Opus 主力'],
  flash: ['Flash 来了', '闪电模式', '快快快', '快就完事了', '光速模式'],
  pro: ['Pro 来了', 'Pro 出战', '专业模式', '满血版', 'Pro 拉满'],
  mini: ['Mini 来了', 'Mini 轻装上阵', '小模型也够用', '迷你选手', 'Mini 省流'],
}

/** English model-switch quips. */
export const EN_MODEL_QUIPS: Readonly<Record<string, readonly string[]>> = {
  claude: ['Claude is in', 'Switching to Claude', 'Claude takes the wheel', 'Claude reporting'],
  gpt: ['GPT is in', 'Switching to GPT', 'GPT on duty', 'GPT reporting'],
  grok: ['Grok is in', 'Grok takes over', 'Mars pilot on deck', 'Grok reporting'],
  gemini: ['Gemini is in', 'Google\'s finest', 'Gemini takes the wheel', 'Gemini reporting'],
  deepseek: ['DeepSeek is in', 'Homegrown champ', 'DeepSeek reporting', 'DS on duty'],
  haiku: ['Haiku in the fast lane', 'Haiku reporting', 'Short and snappy mode'],
  sonnet: ['Sonnet is in', 'The wordsmith', 'Sonnet reporting', 'Fourteen lines of glory'],
  opus: ['Opus is in', 'The big guns', 'Opus reporting', 'Full power mode'],
  flash: ['Flash is in', 'Lightning mode', 'Zoom zoom', 'Flash reporting'],
  pro: ['Pro is in', 'Pro mode', 'Maxed out', 'Pro reporting'],
  mini: ['Mini is in', 'Small but mighty', 'Lite mode', 'Mini reporting'],
}

/** Detect a holiday for `date`, Lunar New Year first. */
export function holidayPhrase(date: Date): string | null {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const ymd = `${date.getFullYear()}-${mmdd}`
  const en = langNow() === 'en'
  if (LUNAR_NEW_YEAR_DAYS[ymd] === true) {
    return pickPhrase(en ? EN_LUNAR_NEW_YEAR_PHRASES : LUNAR_NEW_YEAR_PHRASES)
  }
  const pool = en ? EN_HOLIDAY_PHRASES[mmdd] : HOLIDAY_PHRASES[mmdd]
  if (pool !== undefined) return pickPhrase(pool)
  return null
}

/** Pick a rare easter-egg phrase in the active language. */
export function rarePhrase(previous?: string): string {
  return pickPhrase(langNow() === 'en' ? EN_RARE_PHRASES : RARE_PHRASES, previous)
}

/** Pick a weekend greeting in the active language. */
export function weekendPhrase(previous?: string): string {
  return pickPhrase(langNow() === 'en' ? EN_WEEKEND_PHRASES : WEEKEND_PHRASES, previous)
}

/** Pick a post-interruption phrase in the active language. */
export function continuePhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_CONTINUE_PHRASES : CONTINUE_PHRASES)
}

/** Pick a post-compaction phrase in the active language. */
export function compactPhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_COMPACT_PHRASES : COMPACT_PHRASES)
}

/** Pick an overflow phrase in the active language. */
export function overflowPhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_OVERFLOW_PHRASES : OVERFLOW_PHRASES)
}

/** Pick a compact-retry phrase in the active language. */
export function compactRetryPhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_COMPACT_RETRY_PHRASES : COMPACT_RETRY_PHRASES)
}

/**
 * Quip for a model id (substring match), or null when no pool matches.
 * @param modelId - Model id, e.g. `deepseek-chat` or `gpt-4o`.
 */
export function modelQuip(modelId: string): string | null {
  const lower = modelId.toLowerCase()
  const quips = langNow() === 'en' ? EN_MODEL_QUIPS : MODEL_QUIPS
  for (const [key, pool] of Object.entries(quips)) {
    if (lower.includes(key)) return pickPhrase(pool)
  }
  return null
}

/** Feature toggles for the lively phrase selector. */
export interface LivelyFeatures {
  /** Allow rare 1/150 easter eggs. */
  readonly rareEggs?: boolean
  /** Allow weekend greetings on Sat/Sun. */
  readonly weekend?: boolean
  /** Allow date-matched holiday / Lunar New Year copy. */
  readonly holidays?: boolean
  /** Mix night-owl copy between 00:00 and 06:00. */
  readonly nightPhrases?: boolean
}

/**
 * Pick a thinking phrase with the pi extension's egg order: holiday first,
 * then rare (1/150), then weekend, then the elapsed-time tiers with night
 * mixing. Every egg is gated by `features` (defaults all on).
 * @param elapsedMs - Milliseconds spent thinking in the current phase.
 * @param previous - Previously shown phrase, to avoid repeats.
 * @param night - Whether the night window is active (mixes night copy).
 * @param now - Current wall-clock time (injectable for tests).
 * @param features - Feature toggles; absent flags default to on.
 * @param extra - User custom phrases appended to the base thinking pool.
 */
export function livelyThinkingPhrase(
  elapsedMs: number,
  previous?: string,
  night = false,
  now: Date = new Date(),
  features: LivelyFeatures = {},
  extra?: readonly string[],
): string {
  if (features.holidays !== false) {
    const holiday = holidayPhrase(now)
    if (holiday !== null) return holiday
  }
  if (features.rareEggs !== false && Math.random() < RARE_CHANCE) {
    return rarePhrase(previous)
  }
  if (features.weekend !== false && isWeekend(now)) {
    return weekendPhrase(previous)
  }
  return thinkingPhrase(elapsedMs, previous, features.nightPhrases !== false && night, extra)
}

/** Common git tool names / bash commands containing `git `. */
export const GIT_TOOL_RE = /^(?:git|git_diff|git_commit|git_push|git_pull|git_checkout|git_branch|git_merge|git_rebase|github|gh)$/i

/** Detect the 00:00–06:00 night window (local time). */
export function isNight(hour: number): boolean {
  return hour >= 0 && hour < 6
}

/** The zh or en base thinking pool by the active language. */
function thinkingPools(): readonly { atMs: number; pool: readonly string[] }[] {
  return langNow() === 'en' ? EN_THINKING_TIERS : THINKING_TIERS
}

/** The zh or en base waiting pool by the active language. */
export function waitingPool(): readonly string[] {
  return langNow() === 'en' ? EN_WAITING_PHRASES : WAITING_PHRASES
}

/**
 * Pick a thinking phrase appropriate for the elapsed thinking time, in the
 * active language.
 * @param elapsedMs - Milliseconds spent thinking in the current phase.
 * @param previous - Previously shown phrase, to avoid repeats.
 * @param night - Mix night-owl copy into the pool.
 * @param extra - User custom phrases appended to the base (non-tier) pool.
 */
export function thinkingPhrase(elapsedMs: number, previous?: string, night = false, extra?: readonly string[]): string {
  let pool: readonly string[] = langNow() === 'en' ? EN_THINKING_PHRASES : THINKING_PHRASES
  for (const tier of thinkingPools()) {
    if (elapsedMs >= tier.atMs) {
      pool = tier.pool
      break
    }
  }
  // Custom phrases ride every candidate pool (base and tiers alike), so user
  // copy keeps showing up on long thinking too.
  if (extra !== undefined && extra.length > 0) {
    pool = [...pool, ...extra]
  }
  if (night && pool === (langNow() === 'en' ? EN_THINKING_PHRASES : THINKING_PHRASES)) {
    const nightPool = langNow() === 'en' ? EN_NIGHT_PHRASES : NIGHT_PHRASES
    return pickPhrase([...pool, ...nightPool], previous)
  }
  return pickPhrase(pool, previous)
}

/** Pick a waiting phrase in the active language. */
export function waitingPhrase(previous?: string): string {
  return pickPhrase(waitingPool(), previous)
}

/** Pick a tool-failure phrase in the active language. */
export function failPhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_FAIL_PHRASES : FAIL_PHRASES)
}

/** Pick a turn-completion phrase in the active language. */
export function donePhrase(): string {
  return pickPhrase(langNow() === 'en' ? EN_DONE_PHRASES : DONE_PHRASES)
}

/**
 * Map a tool name to a playful action verb, in the active language.
 * @param toolName - Registry tool name (unqualified).
 * @param custom - Exact-name custom action pools, matched case-insensitively
 *   (user-owned copy, used verbatim in any language).
 */
export function actionFor(toolName: string, custom?: Readonly<Record<string, readonly string[]>>): string {
  const normalized = toolName.trim().toLowerCase()
  const customPool = custom?.[normalized]
  if (customPool !== undefined && customPool.length > 0) return pickPhrase(customPool)
  const map = langNow() === 'en' ? EN_ACTION_MAP : ACTION_MAP
  const fallback = langNow() === 'en' ? EN_FALLBACK_ACTIONS : FALLBACK_ACTIONS
  for (const { test, actions } of map) {
    if (test.test(normalized)) return pickPhrase(actions)
  }
  return pickPhrase(fallback)
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
