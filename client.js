/**
 * dsh-bili-scroll-plus —— 浏览器半端（**设置在「设置」里的一页**）
 * ============================================================================
 * ⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * ⭐ **怎么进「设置」**（抄第三方插件 `dsh-meme/client.js`，2026-10-14 使用者指出位置不对后才查到）：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },   // label = 左侧导航那一项
 *       () => h(Panel),
 *     ))
 *
 *   ⇒ **别自己糊一个标题栏按钮 + 全屏 overlay** ✗（第一版就是这么干的，使用者一眼看出"跟别的插件不一样"）。
 *
 * 这一页要满足使用者 2026-10-14 说的形状：
 *   · **总开关 → 打开之后下面才展开子开关**（峰谷自动刷 → 中午 / 晚上）
 *   · **数字项要能自己填**（定量刷：每天几条）
 *   · **账号绑定必须在设置页里**（扫码登录 + 二维码直接显示在页里）
 *   · 会发东西出去的（自动评论）、要下大模型的（本地转写）**默认关**
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-scroll-plus',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/bili-duty'
    /* ⚠️ 原来 jget/jpost 直接 .json()、从不看 res.ok ⇒ HTTP 500 的 {ok:false,error}
     *    会被调用方当成「已保存 / 成功」，绿色提示把故障盖掉。（2026-10-16 审查修） */
    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）' : res.status === 403 ? '（被宿主拦了）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-bd-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;}
    [data-bd-page][data-bd-wide]{max-width:none;width:100%;}
    [data-bd-page][data-bd-wide] [data-bd-list]{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
[data-bd-sec]{display:flex;flex-direction:column;gap:8px;}
[data-bd-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-bd-grow]{flex:1;min-width:0;}
[data-bd-label]{font-size:13px;}
[data-bd-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-bd-sw][data-on]{background:#3b82f6;}
[data-bd-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-bd-sw][data-on] i{left:19px;}
[data-bd-sw][disabled]{opacity:.45;cursor:default;}
[data-bd-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.1));
  display:flex;flex-direction:column;gap:10px;}
[data-bd-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-bd-input]:focus{outline:none;border-color:#3b82f6;}
[data-bd-num]{width:88px;text-align:center;}
[data-bd-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:inherit;}
[data-bd-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-bd-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-bd-btn][disabled]{opacity:.5;cursor:default;}
[data-bd-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-msg][data-warn]{color:#f59e0b;}
[data-bd-msg][data-good]{color:#22c55e;}
[data-bd-qr]{display:flex;gap:14px;align-items:flex-start;}
[data-bd-qr] img{width:150px;height:150px;border-radius:8px;background:#fff;padding:6px;}
[data-bd-pre]{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:170px;overflow:auto;font-size:11px;
  line-height:15px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}
    /* ⭐ 2026-10-21 重做：卡片网格 + 颜色全部取「真实存在」的主题变量
       （之前用了 --dsw-alias-bg-layer-1 / --dsw-alias-bg-layer-3 —— 这两个在应用里根本不存在 ⇒
        fallback 落到硬编码深色，而文字用的 --dsw-alias-label-primary 是存在的 ⇒ 浅色主题下变近黑 ⇒ 黑底黑字看不见） */
    [data-bd-list]{margin:10px 0 0;max-height:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;}
    [data-bd-item]{display:flex;flex-direction:column;overflow:hidden;border-radius:12px;
      background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));
      border:1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));
      color:var(--dsw-alias-label-primary,inherit);}
    [data-bd-cover]{display:block;width:100%;aspect-ratio:16/9;height:auto;object-fit:cover;
      background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));}
    [data-bd-item-body]{display:flex;flex-direction:column;gap:4px;padding:9px 11px;min-width:0;}
    [data-bd-item-t]{font-size:13px;line-height:18px;font-weight:600;
      color:var(--dsw-alias-label-primary,inherit);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}
    [data-bd-item-t] a{color:inherit;text-decoration:none;}
    [data-bd-item-t] a:hover{text-decoration:underline;}
    [data-bd-item-n]{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,inherit);margin:0;}
    [data-bd-item-why]{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,inherit);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    [data-bd-clickable]{cursor:pointer;transition:border-color .12s,background .12s;}
    [data-bd-clickable]:hover{border-color:var(--dsw-alias-brand-primary,rgba(76,141,255,.5));
      background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-tabs]{display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));}
    [data-bd-tab]{flex:1;min-width:0;cursor:pointer;font:inherit;font-size:13px;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-tab]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-tab][aria-selected=true]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12);}
    [data-bd-away]{display:none !important;}
    [data-bd-chip]{cursor:pointer;white-space:nowrap;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;
      border:1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));background:transparent;
      color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-chip]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-chip][aria-selected=true]{color:var(--dsw-alias-label-primary,inherit);
      border-color:var(--dsw-alias-brand-primary,rgba(76,141,255,.6));
      background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8dff) 16%,transparent);}
    [data-bd-tier]{font-weight:600;color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-tier='值得看']{color:#3fb950;}
    [data-bd-tier='可以看']{color:#d29922;}
    [data-bd-tier='不值当']{color:var(--dsw-alias-label-tertiary,inherit);}
[data-bd-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-bd-badge]{font-size:11px;padding:2px 7px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:var(--dsw-alias-label-secondary,#c9ccd1);}
`

    // ⚠️ 与 lib/state.mjs 的 WINDOWS 保持一致（官方口径：工作日 9–12、14–18 是高峰，其余都是谷时）
    const DEFAULT_WINDOWS = {
      noon: { label: '中午谷时', start: '12:00', end: '14:00' },
      night: { label: '晚上/夜间谷时', start: '18:00', end: '09:00' },
    }

    /* ────────────── 小组件 ────────────── */

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-bd-sw': '',
        'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        title: on ? '已开' : '已关',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      // ⭐ 2026-10-19（用户报"没有开关这一项，只能让 ai 帮我开"）：读不到配置时界面只显示"读设置中…"，
      //    用户会以为是开关坏了 ✗ ⇒ 数一下连续失败次数，交给界面把话说清楚（版本太旧 / 没重启 / 读不到）
      const [fails, setFails] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await jget('/status')
            if (!alive) return
            if (d && d.ok) { setSt(d); setFails(0) } else setFails((n) => n + 1)
          } catch { if (alive) setFails((n) => n + 1) }
        }
        tick()
        const t = setInterval(tick, intervalMs || 5000)
        return () => { alive = false; clearInterval(t) }
      }, [intervalMs])
      return [st, setSt, fails]
    }

    /* ────────────── 设置页正文 ────────────── */

/* ────────────── 会话头那个 tab：它刷过的视频（最小实验版）────────────── */
function WatchTab() {
  const PAGE = 30
  const onOpenUrl = (u) => { jpost('/open', { what: 'url', u }).catch(() => {}) }
  const [rows, setRows] = React.useState(null)
  const [st, setSt] = React.useState('')      // '' | picked | skipped | commented
  const [tier, setTier] = React.useState('')  // '' | 值得看 / 可以看 / 不值当
  const [offset, setOffset] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const load = (s, t, off) => {
    setRows(null)
    const q = `/watched?limit=${PAGE}&offset=${off}` + (s ? '&state=' + s : '') + (t ? '&tier=' + encodeURIComponent(t) : '')
    jget(q).then((r) => {
      if (!r || !r.ok) { setRows([]); return }
      setRows(r.rows || [])
      setTotal(Number(r.total) || 0)
    }).catch(() => setRows([]))
  }
  React.useEffect(() => { load("", "", 0) }, [])
  const pick = (kind, v) => {
    const next = (kind === 'state' ? st : tier) === v ? '' : v
    if (kind === 'state') setSt(next); else setTier(next)
    setOffset(0)
    load(kind === 'state' ? next : st, kind === 'tier' ? next : tier, 0)
  }
  const go = (d) => { const n = Math.max(0, Math.min(offset + d, Math.max(0, total - 1))); setOffset(n); load(st, tier, n) }
  const chip = (label, on, active) => h('button', { 'data-bd-chip': '', 'aria-selected': active ? 'true' : 'false', onClick: on }, label)
  return h('div', { 'data-bd-page': '', 'data-bd-wide': '' },
    h('div', { 'data-bd-row': '' },
      chip('全部', () => pick('state', ''), st === ''),
      chip('挑了', () => pick('state', 'picked'), st === 'picked'),
      chip('跳过', () => pick('state', 'skipped'), st === 'skipped'),
      chip('发给你了', () => pick('state', 'commented'), st === 'commented'),
      chip('刷新', () => { setOffset(0); load(st, tier, 0) }, false),
      h('div', { 'data-bd-note': '' }, rows === null ? '读取中…' : `共 ${total} 条`)),
    h('div', { 'data-bd-row': '' },
      chip('值得看', () => pick('tier', '值得看'), tier === '值得看'),
      chip('可以看', () => pick('tier', '可以看'), tier === '可以看'),
      chip('不值当', () => pick('tier', '不值当'), tier === '不值当')),
    rows && rows.length ? h('div', { 'data-bd-list': '' },
      rows.map((x, i) => h('div', { key: x.day + x.bvid, 'data-bd-item': '', 'data-bd-clickable': '', title: '在浏览器打开', onClick: () => onOpenUrl(x.url) },
        i < 30 ? h('img', { 'data-bd-cover': '', src: API + '/cover?bv=' + x.bvid, loading: 'lazy', alt: '' }) : null,
        h('div', { 'data-bd-item-body': '' },
          h('div', { 'data-bd-item-t': '' }, x.title),
          h('div', { 'data-bd-item-n': '' }, `${x.day} · ${x.up} · `, x.picked ? '挑中了' : (x.status && /跳过/.test(x.status) ? '跳过' : '看过'), (x.delivered || x.commented) ? ' · 已发给你' : '',
            x.tier ? h('span', { 'data-bd-tier': x.tier }, ' · ' + x.tier) : null),
          x.why ? h('div', { 'data-bd-item-why': '' }, x.why) : null))))
      : h('div', { 'data-bd-note': '' }, rows === null ? '' : '这一类还没有记录 —— 跑一轮之后就有了'),
    total > PAGE ? h('div', { 'data-bd-row': '' },
      h('button', { 'data-bd-btn': '', disabled: offset <= 0, onClick: () => go(-PAGE) }, '上一页'),
      h('div', { 'data-bd-note': '' }, `${offset + 1}–${Math.min(offset + PAGE, total)} / ${total}`),
      h('button', { 'data-bd-btn': '', disabled: offset + PAGE >= total, onClick: () => go(PAGE) }, '下一页')) : null)
}

    function Panel() {
      const [st, setSt, fails] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgTone, setMsgTone] = React.useState('')
      const [kws, setKws] = React.useState(null)
      const [favFolders, setFavFolders] = React.useState(null)   // 收藏夹列表（下拉用，null = 还没读）
      const [favId, setFavId] = React.useState(null)             // 选中的收藏夹 fid（字符串）
      const [persona, setPersona] = React.useState(null)   // 人设提示词草稿
      const [rl, setRl] = React.useState(null)
      const [newVer, setNewVer] = React.useState('')       // 发现的新版本号（空 = 没发现）          // 日报形态：full / brief / off
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [pickPerRound, setPickPerRound] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      const [replyPer, setReplyPer] = React.useState(null)
      const [dmUid, setDmUid] = React.useState(null)        // 私信收件人 UID（本地草稿）
      const [dmWatch, setDmWatch] = React.useState(null)          // 后台私信总开关
      const [dmWhitelist, setDmWhitelist] = React.useState(null)
      const [dmStrangerText, setDmStrangerText] = React.useState(null)
      const [dmStrangerMax, setDmStrangerMax] = React.useState(null)
      const [commentTopCount, setCommentTopCount] = React.useState(null)
      const [commentTopVideoCount, setCommentTopVideoCount] = React.useState(null)
      const [commentReplyPerPoll, setCommentReplyPerPoll] = React.useState(null)
      const [commentReplyPerDay, setCommentReplyPerDay] = React.useState(null)
      const [dailyPublicCommentLimit, setDailyPublicCommentLimit] = React.useState(null)
      const [dmMode, setDmMode] = React.useState(null)      // 投递方式：off / only / both
      const [mention, setMention] = React.useState(null)
      const [mentionTargets, setMentionTargets] = React.useState(null)
      const [mentionMode, setMentionMode] = React.useState(null)
      const [modelDraft,setModelDraft] = React.useState(null)
      const [approvals,setApprovals] = React.useState([])
      const [approvalPhrase,setApprovalPhrase] = React.useState(null)
      const [approvedTotal,setApprovedTotal] = React.useState(null)
      const [approvedDaily,setApprovedDaily] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)
      const [report, setReport] = React.useState(null)        // 非 null = 报告已展开   // 顶部那行状态（跑一轮/装依赖的反馈原来在最底下，看不见）
      const [watchedRows, setWatchedRows] = React.useState(null)   // null = 还没读；[] = 读到了但没记录
      const [watchedPicked, setWatchedPicked] = React.useState(false) // 只看挑中的
    const [watchedState, setWatchedState] = React.useState('')
    const [watchedTier, setWatchedTier] = React.useState('')
    const [watchedOffset, setWatchedOffset] = React.useState(0)
    const [watchedTotal, setWatchedTotal] = React.useState(0)
    const [tab, setTab] = React.useState('daily')   // daily | taste | social | adv
      const [diag, setDiag] = React.useState(null)      // 诊断信息文本
      const [checks, setChecks] = React.useState(null)   // 环境自检结果 [{name, ok, detail, fix}]
      const [loginState, setLoginState] = React.useState('')
      const [loginTone, setLoginTone] = React.useState('')
      /* ⚠️ 扫码轮询的 timer 必须能停：切走设置页后还在跑的话会在已卸载的组件上 setState，
       *    重复点「扫码登录」还会叠出第二个 timer。（2026-10-16 审查修） */
      const loginTimer = React.useRef(null)
      const alive = React.useRef(true)
      React.useEffect(() => () => {
        alive.current = false
        if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }
      }, [])

      const cfg = st?.config
      React.useEffect(()=>{
        if(tab!=='social' || !cfg?.dmApprovalEnabled)return
        jget('/dm-approvals').then(x=>{if(alive.current)setApprovals(x.approvals||[])}).catch(()=>{})
      },[tab,cfg?.dmApprovalEnabled])
      React.useEffect(() => {
        if (cfg && kws === null) setKws((cfg.keywords || []).join('\n'))
        if (cfg && persona === null) setPersona(cfg.personaPrompt || '')
        if (cfg && rl === null) setRl(cfg.reportLevel || 'full')
        if (cfg && perDay === null) setPerDay(String(cfg.perDay ?? 50))
        if (cfg && pickPerRound === null) setPickPerRound(String(cfg.pickPerRound ?? 5))
        if (cfg && perRound === null) setPerRound(String(cfg.commentPerRound ?? 5))
        if (cfg && dailyPublicCommentLimit === null) setDailyPublicCommentLimit(String(cfg.commentDailyLimit ?? 10))
        if (cfg && replyPer === null) setReplyPer(String(cfg.replyPerRound ?? 1))
        if (cfg && mention === null) setMention(cfg.mentionName || '')
        if (cfg && mentionTargets === null) setMentionTargets(cfg.mentionTargets || '')
        if (cfg && mentionMode === null) setMentionMode(cfg.mentionMode || 'ai')
        if (cfg && dmUid === null) setDmUid(cfg.dmUid ? String(cfg.dmUid) : '')
        if (cfg && dmMode === null) setDmMode(cfg.dmMode || 'only')
        if (cfg && dmWatch === null) setDmWatch(cfg.dmWatch !== false)
        if (cfg && dmWhitelist === null) setDmWhitelist(cfg.dmWhitelist || '')
        if (cfg && dmStrangerText === null) setDmStrangerText(cfg.dmStrangerText || '')
        if (cfg && dmStrangerMax === null) setDmStrangerMax(String(cfg.dmStrangerMaxReplies ?? 1))
        if(cfg && modelDraft===null) setModelDraft(Object.fromEntries(['videoModelProvider','videoModelId','videoReasoningEffort','interactionModelProvider','interactionModelId','interactionReasoningEffort'].map(k=>[k,cfg[k]||''])))
        if(cfg && approvalPhrase===null) setApprovalPhrase(cfg.dmApprovalPhrase || '白饭🍚')
        if(cfg && approvedTotal===null) setApprovedTotal(String(cfg.dmApprovedTotalLimit ?? 50))
        if(cfg && approvedDaily===null) setApprovedDaily(String(cfg.dmApprovedDailyLimit ?? 10))
        if (cfg && commentTopCount === null) setCommentTopCount(String(cfg.commentTopCount ?? 5))
        if (cfg && commentTopVideoCount === null) setCommentTopVideoCount(String(cfg.commentTopVideoCount ?? 3))
        if (cfg && commentReplyPerPoll === null) setCommentReplyPerPoll(String(cfg.commentReplyPerPoll ?? 1))
        if (cfg && commentReplyPerDay === null) setCommentReplyPerDay(String(cfg.commentReplyPerDay ?? 5))
        if (cfg && favId === null) setFavId(String(cfg.favFolderId ?? 0))
      }, [cfg])

      // ⭐ 收藏夹列表：只读一次，读不到就空列表（别每 5 秒重拉）
      React.useEffect(() => {
        if (favFolders !== null) return
        jget('/fav-folders').then((r) => { if (alive.current) setFavFolders(r && r.ok ? (r.folders || []) : []) })
          .catch(() => { if (alive.current) setFavFolders([]) })
      }, [favFolders])

      const win = { ...DEFAULT_WINDOWS, ...(st?.windows || {}) }

      const say = (text, tone) => {
        setMsg(text); setMsgTone(tone || '')
        setRunNote(text ? { t: text, tone: tone || '' } : null)   // ⭐ 同时镜像到顶部，免得提示掉到页面最底下看不见
      }

      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (!r || r.ok !== true) throw new Error((r && r.error) || '设置接口没有确认保存成功')
          // 收藏夹字段曾被服务端允许列表漏掉：必须核对服务端实际保存的 ID，杜绝假成功。
          if (Object.prototype.hasOwnProperty.call(p, 'favFolderId')) {
            const savedFid = Math.max(0, Math.floor(Number(r.config?.favFolderId) || 0))
            const wantedFid = Math.max(0, Math.floor(Number(p.favFolderId) || 0))
            if (savedFid !== wantedFid) {
              setFavId(String(savedFid))
              throw new Error('收藏夹没有保存成功：服务端返回 ' + savedFid + '，期望 ' + wantedFid + '。请确认插件文件已更新并重启 DSH')
            }
          }
          if (r.config) setSt((old) => ({ ...old, config: r.config }))
          // ⭐ DSH 原生设置页里显式设过的键由宿主说了算 ⇒ 我们这份也得写进去；写失败要说出来，别假装"已保存"
          if (r?.host && r.host.ok === false) say(`${what || '设置'}：插件自己那份存了，但 DSH 设置页那份没写进去（${r.host.error}）`, 'warn')
          else say(what ? `${what}：已保存` : '已保存', 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      // 「它刷过的视频」：点开才读，读一次就留着（不会每 5 秒重拉）
    const WATCH_PAGE = 30
    const onLoadWatched = async (st, tr, off) => {
      setBusy('watched')
      try {
        const q = `/watched?limit=${WATCH_PAGE}&offset=${off}` + (st ? '&state=' + st : '') + (tr ? '&tier=' + encodeURIComponent(tr) : '')
        const r = await jget(q)
        setWatchedRows(r && r.ok ? (r.rows || []) : [])
        setWatchedTotal(r && r.ok ? (Number(r.total) || 0) : 0)
        setWatchedState(st)
        setWatchedTier(tr)
        setWatchedOffset(off)
        if (!r || r.ok === false) say('读不到记录：' + ((r && r.error) || '未知原因'), 'warn')
      } catch (e) { say('读不到记录：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
    }
    const onWatchPick = (kind, v) => {
      const cur = kind === 'state' ? watchedState : watchedTier
      const next = cur === v ? '' : v
      return onLoadWatched(kind === 'state' ? next : watchedState, kind === 'tier' ? next : watchedTier, 0)
    }
    const onWatchPage = (d) => onLoadWatched(watchedState, watchedTier, Math.max(0, watchedOffset + d))

      const onShowReport = async () => {
        if (report !== null) { setReport(null); return }       // 再点一次收起
        setBusy('report')
        try {
          const r = await jget('/report')
          setReport(r && r.exists ? (r.text || '（报告是空的）') : '今天还没有报告 —— 跑一轮之后就有了')
        } catch (e) { setReport('读不到报告：' + String(e?.message ?? e)) } finally { setBusy('') }
      }

      // ⭐ 复核评论：接口回"发送成功"≠ 公开可见（新号/风控会进审核，那时候连 @ 都不会推）
      //    所以让宿主真去拉一次评论列表 / 楼中楼，确认那条到底在不在。
      const onVerify = async () => {
        setBusy('verify')
        try {
          const r = await jpost('/verify', {})
          if (!r || !r.ok) { say('复核没跑成：' + ((r && r.error) || '未知原因'), 'warn'); return }
          const n = (r.checked || []).length
          const vis = (r.checked || []).filter((c) => c.visible === true).length
          if (!n) say(r.text || '没有需要复核的记录', 'good')
          else say(`复核完 ${n} 条：公开可见 ${vis} 条，其余「没查到」（可能还在审核 —— 看不到不等于没发出去）。结果也追加到今天的报告末尾了。`, vis ? 'good' : 'warn')
          if (r.report) setReport(null)
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      // ⭐ 把"要日志"变成"点一下"（2026-10-21）
      const onDiagnose = async () => {
        setBusy('diag')
        try {
          const r = await jget('/diagnose')
          const text = String(r?.text || '（没拿到诊断信息）')
          setDiag(text)
          copyText(text).catch(() => {})
          say('诊断信息已生成并复制到剪贴板', 'good')
        } catch (e) { say('生成诊断信息失败：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }
      const onSelfCheck = async () => {
        setBusy('selfcheck')
        try {
          const r = await jget('/selfcheck')
          setChecks(Array.isArray(r?.items) ? r.items : [])
        } catch (e) { say('自检失败：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const copyText = async (text) => {
        const v = String(text || '')
        try {
          await navigator.clipboard.writeText(v)
          say('已复制：' + v, 'good')
        } catch {
          say('复制失败 —— 路径是：' + v)       // 兜底：至少把路径显示出来，手动选中也能复制
        }
      }

      const onOpenFolder = async (what) => {
        try {
          const r = await jpost('/open', { what })
          if (r && r.ok) say('已请系统打开：' + (r.opened || '') + '（要是没看到窗口，用旁边的「复制报告路径」——那个一定成）', 'good')
          else say('打不开（' + ((r && r.error) || '未知原因') + '）—— 你可以手动打开这个路径：' + ((r && r.dir) || ''))
        } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      const onUpgrade = async () => {
        setBusy('upgrade')
        try {
          const r = await jpost('/upgrade', {})
          // 原来这两句分两次 say，第二句把服务端的 hint 冲掉了 —— 合成一句。（2026-10-16 审查修）
          say(((r && r.hint) || '正在升级') + ' —— 升级过程写在下面的「主依赖的日志」里；完了记得重启一次 dsh（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheckUpdate = async () => {
        setBusy('update')
        try {
          const r = await jget('/update')
          if (r && r.ok && r.latest) {
            const from = r.source === 'github' ? '（npm 上还没发上去，这个版本来自 GitHub）' : ''
            if (r.hasNew) {
              setNewVer(r.latest)
              say('有新版 v' + r.latest + '（你的是 v' + r.current + '）' + from + ' —— 点右边的「一键升级」，完了重启一次 dsh', 'warn')
            } else say('已经是最新版 v' + r.current + from, 'good')
          } else {
            say('查不到最新版（可能网络不通）—— 你现在的版本是 v' + ((r && r.current) || '?'))
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheck = async () => {
        setBusy('check')
        say('')
        try {
          const r = await jpost('/check', {})
          if (r && r.ok) say('能用！' + (r.steps || []).join('、'))
          else say('还不能用：' + (r && r.error ? r.error : '没拿到结果'))
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstallAsr = async () => {
        setBusy('asr')
        say('')
        try {
          const r = await jpost('/install-asr', {})
          say(r?.started ? '开始装转写依赖 —— 进度显示在下面（要下模型，慢一点正常）' : (r?.hint || '没起来'),
            r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        say('')
        try {
          const r = await jpost('/install', {})
          say(r?.hint || '已经在后台开始装了', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          say(r?.started ? '已经在后台跑一轮了，报告会写在 out/ 里' : '没起来，看 duty.log', r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onLoginStart = async () => {
        setBusy('login')
        setLoginTone('')
        setLoginState('正在出码…')
        try {
          const r = await jpost('/login/start', {})
          if (!r?.ok) { setLoginTone('warn'); setLoginState(r?.error || '出码失败'); return }
          setLogin({ key: r.key, qr: r.qr })
          if (!r.qr) { setLoginTone('warn'); setLoginState('没画出二维码 —— 先点上面的「重装依赖」（venv 里要有 qrcode）') }
          else setLoginState('用手机 B站 扫这张码')
          if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }   // 重复点：先把上一轮停掉
          let n = 0
          const stop = () => { clearInterval(timer); if (loginTimer.current === timer) loginTimer.current = null }
          const timer = setInterval(async () => {
            if (!alive.current) { stop(); return }        // 已经切走设置页了：别再问、别再 setState
            n += 1
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (p?.state === 'ok') {
                stop(); setLogin(null)
                setLoginTone('good'); setLoginState('登录成功')
                setSt((old) => ({ ...old, loggedIn: true }))
              } else if (p?.state === 'scanned') { setLoginTone(''); setLoginState('扫到了，请在手机上确认') }
              else if (p?.state === 'expired') { stop(); setLogin(null); setLoginTone('warn'); setLoginState('二维码过期了，再点一次「扫码登录」') }
              // ⚠️ 扫码成功但响应里没有 SESSDATA 时服务端回 state='unknown'：原来没这个分支
              //    ⇒ 界面一直显示「等扫码…」，用户白等 3 分钟才超时。（2026-10-16 审查修）
              else if (p?.state === 'unknown') {
                stop(); setLogin(null); setLoginTone('warn')
                setLoginState('没登上：' + (p?.message || '响应里没有 SESSDATA —— 再点一次「扫码登录」'))
              }
              else { setLoginTone(''); setLoginState('等扫码…') }
            } catch { /* 抖动就下次再问 */ }
            if (n > 90) { stop(); setLogin(null); setLoginTone('warn'); setLoginState('超时了，再点一次「扫码登录」') }
          }, 2000)
          loginTimer.current = timer
        } catch (e) { setLoginTone('warn'); setLoginState(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      const onFavToday = async () => {
        setBusy('fav')
        try {
          const r = await jpost('/fav-today', {})
          if (!r || r.ok === false || (r.failures && r.failures.length)) {
            const summary = (r && r.error) || (r && r.failures && r.failures[0]) || '未知原因'
            say('收藏未全部成功：' + summary, 'warn')
          } else {
            say(`收藏 API 已接受：${r.added}/${r.total} 条（可到 B站收藏夹核对）`, 'good')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onSaveText = async () => {
        const list = String(kws || '').split('\n').map((s) => s.trim()).filter(Boolean)
        await patch({ keywords: list, personaPrompt: String(persona || '').trim() }, '关键词 / 人设 / 工作区')
      }

      if (!cfg) {
        return h('div', { 'data-bd-page': '' },
          h('div', { 'data-bd-note': '' }, fails >= 3
            ? '读不到插件配置（已经试了 ' + fails + ' 次）。常见原因有三个：装的还是 0.1.11 / 0.1.12（那两版有 bug，会卡在这里）；刚装完没重启 dsh；或者插件加载失败。'
            : '读设置中…'),
          fails >= 6 ? h('div', { 'data-bd-note': '' },
            '可以先试：升级到最新版（dsh plugin --profile web add github:minedalang/dsh-bili-scroll-plus）→ 重启 dsh；还不行就把 ' +
            '%USERPROFILE%\\.dsh\\bili-duty\\duty.log 的最后几十行发给作者。') : null)
      }

      const sw = (k) => Boolean(cfg[k])

      return h('div', { 'data-bd-page': '' },

        /* ── 今天 ── */
        h('div', { 'data-bd-row': '' },
          h('span', { 'data-bd-badge': '' }, `今天已挑 ${st.pickedToday ?? st.ranToday ?? 0} / ${cfg.perDay} 条`),
          h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
          h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
            h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
          h('div', { 'data-bd-grow': '' }),
          h('button', { 'data-bd-btn': '', disabled: busy === 'run', onClick: onRun }, '现在跑一轮')),
          runNote ? h('div', { 'data-bd-msg': '', 'data-good': runNote.tone === 'good' ? '' : undefined,
            'data-warn': runNote.tone === 'warn' ? '' : undefined }, runNote.t) : null,


        /* ── 定时 ── */
        h('div', { 'data-bd-tabs': '' },
          [['daily', '日常'], ['taste', '偏好'], ['social', '互动'], ['adv', '高级']].map(([v, label]) =>
            h('button', { key: v, 'data-bd-tab': '', 'aria-selected': tab === v ? 'true' : 'false', onClick: () => setTab(v) }, label))),

        h('div', { 'data-bd-row': '' },
          h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onSaveText }, '保存'),
          msg ? h('div', { 'data-bd-msg': '', 'data-good': msgTone === 'good' ? '' : undefined, 'data-warn': msgTone === 'warn' ? '' : undefined }, msg) : null),

        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': tab === 'daily' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '什么时候自己跑'),
          h(ToggleRow, {
            label: '峰谷时段自动刷',
            note: '只在谷时跑 —— 工作日 12:00–14:00 与 18:00 之后（整个周末也算谷时）；关了就只能手动跑',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '峰谷时段自动刷'),
          }),
          sw('peakValley') ? h('div', { 'data-bd-sub': '' },
            ...['noon', 'night'].map((k) => h(ToggleRow, {
              key: k,
              label: win[k].label,
              note: `${win[k].start} – ${win[k].end}`,
              on: sw(k),
              onChange: (v) => patch({ [k]: v }, win[k].label),
            }))) : null),

        /* ── 一轮挑几条 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': tab === 'daily' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '一轮挑几条'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每天最多挑几条'),
              h('div', { 'data-bd-note': '' }, '填 0 = 今天不再挑选视频（即使手动启动也不会挑新视频）')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0,
              value: perDay ?? '',
              onChange: (e) => setPerDay(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.floor(Number(perDay) || 0)); setPerDay(String(n)); patch({ perDay: n }, '每天挑几条') },
            })),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每轮最多挑几条'),
              h('div', { 'data-bd-note': '' }, '每次点「现在跑一轮」或自动执行时的上限（1～50）；实际不能超过今日剩余额度')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 50, step: 1,
              value: pickPerRound ?? '',
              onChange: (e) => setPickPerRound(e.target.value),
              onBlur: () => {
                const n = Math.max(1, Math.min(50, Math.floor(Number(pickPerRound) || 5)))
                setPickPerRound(String(n))
                patch({ pickPerRound: n }, '每轮最多挑几条')
              },
            })),
          h('div', { 'data-bd-note': '' }, `按当前配置，这一轮最多还能挑 ${st.canPickThisRound ?? Math.max(0, Math.min(Number(cfg.pickPerRound) || 5, (Number(cfg.perDay) || 0) - (Number(st.pickedToday) || 0)))} 条`),
          st.lastRunAt ? h('div', { 'data-bd-note': '' }, `上次跑：${new Date(st.lastRunAt).toLocaleString('zh-CN')}`) : null),

        /* ── 发言与转写 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'social', 'data-bd-away': tab === 'social' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它怎么把结果给你'),
          h('div', { 'data-bd-label': '' }, '投递方式'),
          h('select', {
            'data-bd-input': '', value: dmMode ?? 'only',
            onChange: (e) => { setDmMode(e.target.value); patch({ dmMode: e.target.value }, '投递方式') },
          },
            h('option', { value: 'only' }, '只发私信 —— 一条公开评论都不发（默认，最不打扰别人）'),
            h('option', { value: 'off' }, '只发评论 —— @ 可选（公开，别人能看见）'),
            h('option', { value: 'both' }, '私信 + 评论 —— 两边都发')),
          h('div', { 'data-bd-label': '' }, '旧版昵称（保留兼容，可不改）'),
          h('input', {
            'data-bd-input': '', value: mention ?? '',
            placeholder: '老用户原有的 mentionName；新@名单为空时继承',
            onChange: (e) => setMention(e.target.value),
            onBlur: () => { const v = String(mention || '').trim(); setMention(v); patch(v ? {mentionName:v} : {mentionName:'',clear:['mentionName']}, '旧版昵称') },
          }),
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-label': '' }, '私信推荐收件人 UID（与评论 @ 名单独立）') : null,
          (dmMode && dmMode !== 'off') ? h('input', {
            'data-bd-input': '', value: dmUid ?? '', type: 'number', min: 0,
            placeholder: '输入数字 UID；留空仍兼容旧版昵称查找',
            onChange: (e) => setDmUid(e.target.value),
            onBlur: () => patch({dmUid: Math.max(0, Math.floor(Number(dmUid)||0))}, '私信收件人 UID'),
          }) : null,
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-note': '' }, '这里的 UID 只控制刷视频报告发给谁，不是白名单，也不是公开评论 @ 对象。') : null,
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-label': '' }, '公开评论 @ 名单（每行一个 昵称|UID）'),
          h('textarea', {
            'data-bd-input': '', value: mentionTargets ?? '', rows: 3,
            placeholder: '长条动物|12345678\n另一个好友|87654321',
            onChange: (e) => setMentionTargets(e.target.value),
            onBlur: () => {const t=String(mentionTargets??'').trim();patch(t?{mentionTargets:t}:{mentionTargets:'',clear:['mentionTargets']}, '@好友名单')},
          }),
          h('div', { 'data-bd-note': '' }, '名单为空会继承旧 mentionName。填写正确的 UID 能尝试 B站原生 @；真实提醒是否推送仍由平台决定。'),
          h('div', { 'data-bd-label': '' }, '公开评论 @ 策略'),
          h('select', { 'data-bd-input': '', value: mentionMode ?? 'ai', onChange:(e)=>{setMentionMode(e.target.value);patch({mentionMode:e.target.value}, '@ 策略')} },
            h('option', {value:'ai'}, '视情况 @ 所有好友（旧版兼容）'),
            h('option', {value:'ai_select'}, '视情况只 @ 想邀请的某些好友（推荐）'),
            h('option', {value:'off'}, '永远不 @（只评论）'),
            h('option', {value:'always'}, '每条评论 @ 所有好友')),
          h('div', { 'data-bd-note': '' }, 'AI 按视频与情境决定，不使用固定概率。ai_select 可 @ 0、1、2 或多个名单内好友；ai 模式仍一次 @ 所有人。位置可在句首、句中或句尾。'),
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-note': '' }, '私信内容 = 本轮每条的「标题 + 链接 + 一句话」，一轮合并成一条发。⚠️ 建议先让这个号和收件人互关：B站 对「陌生人私信」会限流，还可能不弹提醒。') : null,

          (dmMode === 'off' || dmMode === 'both') ? h('div', { 'data-bd-sep': '' }) : null,
          (dmMode === 'off' || dmMode === 'both') ? h(ToggleRow, {
            label: '自动发表评论（@ 可选）',
            note: '大肥鱼可根据视频内容决定是否 @；不需要每条 @',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }) : null,
          (dmMode === 'off' || dmMode === 'both') && sw('autoComment') ? h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '公开评论每天最多发几条（工具层硬限制）'),
              h('div', { 'data-bd-note': '' }, '含顶层评论及回复，0 表示禁发；默认 10。防止无人值守时刷屏。')),
            h('input', { 'data-bd-input': '', 'data-bd-num': '', type:'number', min:0, max:100,
              value: dailyPublicCommentLimit ?? '10',
              onChange: e => setDailyPublicCommentLimit(e.target.value),
              onBlur: () => { const n=Math.max(0,Math.min(100,Math.floor(Number(dailyPublicCommentLimit)||0)));setDailyPublicCommentLimit(String(n));patch({commentDailyLimit:n}, '评论每日硬上限') }
            })) : null,
          (dmMode === 'off' || dmMode === 'both') && sw('autoComment') ? h(ToggleRow, {
            label: '评论成功后同步到动态',
            note: '默认关闭。仅顶层评论同步；会另外公开发布“评论正文 + 视频链接”的文字动态（不是B站客户端内置勾选接口）。有独立限额、去重保护，可能因接口风控失败。',
            on: sw('commentSyncDynamic'),
            onChange: (v) => patch({ commentSyncDynamic: v }, '评论同步动态'),
          }) : null,
          (dmMode === 'off' || dmMode === 'both') && sw('autoComment') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多发几条评论'),
                h('div', { 'data-bd-note': '' }, '评论可以不 @；填 0 = 这一轮不发评论')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0,
                value: perRound ?? '',
                onChange: (e) => setPerRound(e.target.value),
                onBlur: () => { const n = Math.max(0, Math.floor(Number(perRound) || 0)); setPerRound(String(n)); patch({ commentPerRound: n }, '每轮发几条评论') },
              }))) : null,
          (dmMode === 'off' || dmMode === 'both') ? h(ToggleRow, {
            label: '回复评论（只回楼中楼）',
            note: '开了之后它只回「直接回复到你那条评论下面的人」，不参与讨论',
            on: sw('replyToComments'),
            onChange: (v) => patch({ replyToComments: v }, '回复评论'),
          }) : null,
          (dmMode === 'off' || dmMode === 'both') && sw('replyToComments') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '每轮最多回几条'),
                h('div', { 'data-bd-note': '' }, '只回直接回在你那条评论下面的人')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 10,
                value: replyPer ?? '',
                onChange: (e) => setReplyPer(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(replyPer) || 1, 10)); setReplyPer(String(n)); patch({ replyPerRound: n }, '每轮回几条') },
              }))) : null,

          h('div', { 'data-bd-sep': '' }),
          h(ToggleRow, {
            label: '后台自动检查并回复私信',
            note: '不必点击「跑一轮」；按间隔检查新私信。白名单可多轮聊天；陌生人自动回复需要单独开启。',
            on: Boolean(dmWatch),
            onChange: (v) => { setDmWatch(v); patch({ dmWatch: v }, '后台私信监听') },
          }),
          dmWatch ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '白名单 UID（每行一个，或用逗号分隔）'),
            h('textarea', {
              'data-bd-input': '', rows: 3,
              value: dmWhitelist ?? '',
              placeholder: '12345678\n87654321',
              onChange: (e) => setDmWhitelist(e.target.value),
            }),
            h('div', { 'data-bd-note': '' }, '白名单用户可以一直和 AI 聊天（仍有防刷频率限制）。旧版设置的「私信收件人 UID / 只回谁的私信」也自动加入白名单。'),
            h('button', { 'data-bd-btn': '', onClick: () => patch({ dmWhitelist: dmWhitelist ?? '', clear: ['dmWhitelist'] }, '私信白名单') }, '保存白名单'),
            h(ToggleRow, {
              label: '开启陌生人自动回复',
              note: '默认关闭；每个陌生人最多回复指定次数，按 UID 持久记录。首次启用不追发历史消息。',
              on: Boolean(cfg?.dmStrangerOnce),
              onChange: (v) => patch({ dmStrangerOnce: v }, '陌生人自动回复'),
            }),
            cfg?.dmStrangerOnce ? h('div', { 'data-bd-sub': '' },
              h('div', { 'data-bd-row': '' },
                h('div', { 'data-bd-grow': '' },
                  h('div', { 'data-bd-label': '' }, '每个陌生人最多回复几次（1–20）'),
                  h('div', { 'data-bd-note': '' }, '白名单用户不受此次数限制；第二次起可以使用 AI。')),
                h('input', { 'data-bd-input': '', 'data-bd-num': '', type:'number', min:1,max:20,
                  value:dmStrangerMax ?? '',onChange:(e)=>setDmStrangerMax(e.target.value),
                  onBlur:()=>{const n=Math.max(1,Math.min(20,Math.floor(Number(dmStrangerMax)||1)));setDmStrangerMax(String(n));patch({dmStrangerMaxReplies:n},'陌生人回复上限')} })),
              h(ToggleRow, {label:'第一条使用固定欢迎语',
                note:'打开：第一次固定文本（不花 Token），从第二次开始才调用 AI；关闭：从第一条开始交给 AI。',
                on:cfg?.dmStrangerFirstFixed!==false,
                onChange:(v)=>patch({dmStrangerFirstFixed:v},'首次固定欢迎语')}),
              cfg?.dmStrangerFirstFixed!==false ? h('div', { 'data-bd-label': '' }, '陌生人固定欢迎语（最多 450 字）') : null,
              cfg?.dmStrangerFirstFixed!==false ? h('div', null,
              h('textarea', {
                'data-bd-input': '', rows: 3,
                value: dmStrangerText ?? '',
                onChange: (e) => setDmStrangerText(e.target.value),
              }),
              h('button', { 'data-bd-btn': '',
                onClick: () => patch({ dmStrangerText: dmStrangerText ?? '' }, '陌生人欢迎语'),
              }, '保存欢迎语')) : null) : null,
            h('div', { 'data-bd-sep': '' }),
            h('div', { 'data-bd-label': '' }, '限额聊天申请（原始可信白名单永不限额）'),
            h(ToggleRow,{label:'允许陌生人达到回复次数后申请继续聊天',
              note:'先开启陌生人自动回复；大肥鱼在最后一次自动回复里提示对方发送暗号；收到暗号后只登记待审批，不会擅自通过。',
              on:cfg?.dmApprovalEnabled===true,onChange:v=>patch({dmApprovalEnabled:v},'申请审批开关')}),
            cfg?.dmApprovalEnabled ? h('div',{'data-bd-sub':''},
              h('div',{'data-bd-label':''},'申请暗号（默认：白饭🍚）'),
              h('input',{'data-bd-input':'',value:approvalPhrase??'',onChange:e=>setApprovalPhrase(e.target.value),
                onBlur:()=>patch({dmApprovalPhrase:approvalPhrase||'白饭🍚'},'申请暗号')}),
              h('div',{'data-bd-row':''},
                h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'审批白名单：总回复限额'),
                  h('div',{'data-bd-note':''},'每个获批 UID 累计上限；旧可信白名单不受影响')),
                h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,value:approvedTotal??'',
                  onChange:e=>setApprovedTotal(e.target.value),onBlur:()=>patch({dmApprovedTotalLimit:Math.max(1,Number(approvedTotal)||50)},'审批用户总限额')})),
              h('div',{'data-bd-row':''},
                h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'审批白名单：每日回复限额')),
                h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,value:approvedDaily??'',
                  onChange:e=>setApprovedDaily(e.target.value),onBlur:()=>patch({dmApprovedDailyLimit:Math.max(1,Number(approvedDaily)||10)},'审批用户每日限额')})),
              h('button',{'data-bd-btn':'',onClick:async()=>{
                try{const x=await jget('/dm-approvals');setApprovals(x.approvals||[])}catch(e){say('加载审批名单失败：'+e.message,'warn')}
              }},'刷新审批名单'),
              h('div',{'data-bd-note':''},'每个 UID 独立计数；“最信任白名单”继续保留原来的无限额规则。'),
              ...approvals.map(a=>h('div',{key:a.uid,'data-bd-item':''},
                h('div',{'data-bd-item-t':''},'UID '+a.uid+' · '+(a.status==='pending'?'待审批':a.status==='approved'?'已通过':'已拒绝')+' · 已回复 '+a.total+' 条'),
                h('div',{'data-bd-note':''},a.lastText||''),
                a.status==='pending' ? h('div',{'data-bd-row':''},
                  ...['approve','reject'].map(act=>h('button',{'data-bd-btn':'',onClick:async()=>{
                    try { const result=await jpost('/dm-approvals',{uid:a.uid,action:act});
                      if(!result.ok)throw Error(result.error||'操作失败');
                      const next=await jget('/dm-approvals');setApprovals(next.approvals||[]);
                      say('审批操作已保存','good') }catch(e){say('审批失败：'+e.message,'warn')}
                  }},act==='approve'?'通过并加入限额白名单':'拒绝'))) : null,
                a.status==='approved' ? h('button',{'data-bd-btn':'',onClick:async()=>{
                  try{const result=await jpost('/dm-approvals',{uid:a.uid,action:'revoke'});
                    if(!result.ok)throw Error(result.error||'操作失败');
                    const next=await jget('/dm-approvals');setApprovals(next.approvals||[])}catch(e){say('撤销失败：'+e.message,'warn')}
                }},'撤销限额聊天权限') : null))) : null,
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-label': '' }, '检查间隔（分钟）'),
              h('input', { 'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 120,
                defaultValue: cfg?.dmWatchMinutes ?? 1,
                onBlur: (e) => patch({ dmWatchMinutes: Math.max(1, Math.min(120, Number(e.target.value) || 1)) }, '私信检查间隔'),
              })),
            h('div', { 'data-bd-note': '' },
              '后台状态：',
              st.dmAutoReplyStatus?.lastError ? '错误：' + st.dmAutoReplyStatus.lastError
                : st.dmAutoReplyStatus?.polling ? '正在检查'
                  : st.dmAutoReplyStatus?.lastPollAt ? '上次检查 ' + new Date(st.dmAutoReplyStatus.lastPollAt).toLocaleString() : '等待首次检查'),
          ) : null,
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-label': '' }, '后台评论互动（独立于「跑一轮」）'),
          h(ToggleRow, {
            label: '后台回复别人对我的评论',
            note: '每3分钟读取最近回复通知；首次开启只记录旧通知，不追发。与旧版跑一轮楼中楼回复建议不要同时开启。',
            on: Boolean(cfg?.commentWatchReplies),
            onChange: v => patch({commentWatchReplies:v}, '后台回复评论通知'),
          }),
          h(ToggleRow, {
            label: '主动参与近期视频的热门评论',
            note: '每5分钟检查最近7天挑选的视频的前几条热门评论；优先大肥鱼、投喂、大米饭等玩梗。默认关闭。',
            on: Boolean(cfg?.commentWatchTop),
            onChange: v => patch({commentWatchTop:v}, '主动参与热门评论'),
          }),
          (cfg?.commentWatchReplies || cfg?.commentWatchTop) ? h('div', {'data-bd-sub':''},
            cfg?.commentWatchTop ? h('div',null,
              h('div',{'data-bd-row':''},
                h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'每个视频查看前几条热评')),
                h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,max:20,
                  value:commentTopCount ?? '',onChange:e=>setCommentTopCount(e.target.value),
                  onBlur:()=>{const n=Math.max(1,Math.min(20,Number(commentTopCount)||5));setCommentTopCount(String(n));patch({commentTopCount:n},'查看热门评论数量')}})),
              h('div',{'data-bd-row':''},
                h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'每轮查看最近几个视频')),
                h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,max:6,
                  value:commentTopVideoCount ?? '',onChange:e=>setCommentTopVideoCount(e.target.value),
                  onBlur:()=>{const n=Math.max(1,Math.min(6,Number(commentTopVideoCount)||3));setCommentTopVideoCount(String(n));patch({commentTopVideoCount:n},'检查视频数')}})),
              h(ToggleRow,{label:'也允许回复其他有趣的热门评论',
                note:'关闭时仅尝试回应提到大肥鱼/鲸鱼/投喂等的热评；开启会增加 AI Token 消耗。',
                on:Boolean(cfg?.commentAllowGeneralTop),
                onChange:v=>patch({commentAllowGeneralTop:v},'热门评论拓展互动')})) : null,
            h('div',{'data-bd-row':''},
              h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'每轮最多回复评论')),
              h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,max:5,
                value:commentReplyPerPoll ?? '',onChange:e=>setCommentReplyPerPoll(e.target.value),
                onBlur:()=>{const n=Math.max(1,Math.min(5,Number(commentReplyPerPoll)||1));setCommentReplyPerPoll(String(n));patch({commentReplyPerPoll:n},'每轮评论回复限制')}})),
            h('div',{'data-bd-row':''},
              h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'近24小时最多自动回复评论')),
              h('input',{'data-bd-input':'','data-bd-num':'',type:'number',min:1,max:30,
                value:commentReplyPerDay ?? '',onChange:e=>setCommentReplyPerDay(e.target.value),
                onBlur:()=>{const n=Math.max(1,Math.min(30,Number(commentReplyPerDay)||5));setCommentReplyPerDay(String(n));patch({commentReplyPerDay:n},'每日评论回复限制')}})),
            h('div',{'data-bd-note':''},'互动状态：',st.commentInteractStatus?.lastError ? '错误：'+st.commentInteractStatus.lastError :
              st.commentInteractStatus?.lastPollAt ? '上次检查 '+new Date(st.commentInteractStatus.lastPollAt).toLocaleString() : '等待检查'),
            h('div',{'data-bd-note':''},'不会强制每轮发评论；无值得回应的内容就不回复。')) : null,
          h(ToggleRow, {
            label: '本地转写没字幕的视频',
            note: '默认关；开了以后，没字幕的视频会在本机转写一遍（不花 API 钱）',
            on: sw('transcribe'),
            onChange: (v) => patch({ transcribe: v }, '本地转写'),
          }),
          sw('transcribe') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn': '', disabled: busy === 'asr', onClick: onInstallAsr },
                st.asrReady ? '重装转写依赖' : '装转写依赖'),
              h('div', { 'data-bd-note': '' },
                !st.asrReady ? '还没装 —— 现在开着也没用：没字幕的视频会被跳过（报告里会写"因无字幕跳过 N 条"）'
                  : (st.asrModelReady ? '环境和模型都好了' : '环境好了；模型会在第一次转写时自动下（几百 MB）'))),
            h('div', { 'data-bd-note': '' },
              '点一下就好：建一个独立环境、装 faster-whisper + yt-dlp，并把 Whisper 模型也下好',
              h('br'),
              '（模型默认 small，几百 MB，走国内镜像；装一次就够了）'),
            st.asrTail ? h('div', null,
              h('div', { 'data-bd-note': '' }, st.asrInstalling ? '正在装转写依赖（进度）：' : '转写依赖的日志（末尾）—— 只有「没字幕的视频」用得到它：'),
              h('pre', { 'data-bd-pre': '' }, st.asrTail)) : null) : null),

        /* ── 关注什么 / 在哪儿刷 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'taste', 'data-bd-away': tab === 'taste' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '关注什么'),
          h('textarea', {
            'data-bd-input': '', rows: 5, placeholder: '一行一个关键词；留空用内置那几组',
            value: kws ?? '', onChange: (e) => setKws(e.target.value),
          }),
          h('div', { 'data-bd-label': '' }, '它按什么说话（人设提示词，可留空）'),
          h('textarea', {
            'data-bd-input': '', rows: 6,
            placeholder: '想让它怎么说话就写在这儿 —— 比如「叫我某某，说话简短点，别用 emoji」。也可以直接填一个文件路径（如 D:\\deepseek\\AGENTS.md，或它所在的那个目录），每次运行都会重新读那个文件。留空 = 按中性说话（不扮演任何人）。',
            value: persona ?? '', onChange: (e) => setPersona(e.target.value),
          }),
          h('div', { 'data-bd-note': '' },
            (st.personaFromWs && String(persona || '').trim() === '')
              ? '你现在还是用「工作区」里那份 AGENTS.md 说话的（照旧生效）。想把它搬到这儿改，就把上面的路径填成本机那个目录。'
              : '改完点下面「保存」；下一轮就按这个说话。'),
          h('div', { 'data-bd-label': '' }, '日报写多细'),
          h('select', {
            'data-bd-input': '', value: rl ?? 'full',
            onChange: (e) => { setRl(e.target.value); patch({ reportLevel: e.target.value }, '日报形态') },
          },
            h('option', { value: 'full' }, '完整 —— 每条：标题 / UP / 为什么值得（默认）'),
            h('option', { value: 'brief' }, '薄 —— 每条一两行，只留值不值得 + 链接'),
            h('option', { value: 'off' }, '不写 —— 只发评论，不生成日报文件')),
        h('div', { 'data-bd-label': '' }, '自动收藏到（这一轮挑中的视频存进你的收藏夹）'),
        h('select', {
          'data-bd-input': '', value: favId ?? '0',
          onChange: (e) => { setFavId(e.target.value); patch({ favFolderId: Math.max(0, Number(e.target.value) || 0) }, '自动收藏') },
        },
          h('option', { value: '0' }, '不收藏（默认）'),
          (favFolders || []).map((f) => h('option', { key: String(f.id), value: String(f.id) }, `${f.title}（${f.count} 条）`))),
        h('div', { 'data-bd-row': '' },
          h('button', { 'data-bd-btn': '', disabled: Boolean(busy) || !(Number(cfg.favFolderId) > 0), onClick: onFavToday }, '补收藏今天的'),
          h('div', { 'data-bd-note': '' },
            favFolders === null ? '收藏夹列表读取中…'
              : (favFolders.length ? (Number(cfg.favFolderId) > 0 ? '每轮跑完会把挑中的视频存进上面选的收藏夹' : '请先在上方选一个收藏夹，等待“自动收藏：已保存”后，再点补收藏')
                : '读不到收藏夹 —— 先「扫码登录」，或过会儿重开设置页'))),

          h('div', { 'data-bd-row': '' },
            msg ? h('div', { 'data-bd-msg': '', 'data-good': msgTone === 'good' ? '' : undefined, 'data-warn': msgTone === 'warn' ? '' : undefined }, msg) : null)),

        /* ── 环境与账号 ── */
        /* ── 它刷过的视频 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': tab === 'daily' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它刷过的视频'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'watched', onClick: () => (watchedRows !== null ? setWatchedRows(null) : onLoadWatched(watchedState, watchedTier, watchedOffset)) },
              watchedRows !== null ? '收起' : '看它刷过什么'),
            watchedRows !== null ? h('button', { 'data-bd-btn': '', disabled: busy === 'watched', onClick: () => onLoadWatched(watchedState, watchedTier, 0) }, '刷新') : null,
            h('div', { 'data-bd-note': '' },
              watchedRows === null ? '（点一下读出来；数据来自 seen.md + 日报 + 视频归档）'
                : (watchedTotal ? `共 ${watchedTotal} 条` : '这一类还没有记录 —— 跑一轮之后就有了'))),
          watchedRows !== null ? h('div', { 'data-bd-row': '' },
            [['', '全部'], ['picked', '挑了'], ['skipped', '跳过'], ['commented', '发给你了']].map(([v, label]) =>
              h('button', { key: v || 'all', 'data-bd-chip': '', 'aria-selected': watchedState === v ? 'true' : 'false', onClick: () => onWatchPick('state', v) }, label)),
            ['值得看', '可以看', '不值当'].map((v) =>
              h('button', { key: v, 'data-bd-chip': '', 'aria-selected': watchedTier === v ? 'true' : 'false', onClick: () => onWatchPick('tier', v) }, v))) : null,
          watchedRows !== null && watchedRows.length ? h('div', { 'data-bd-list': '' },
            watchedRows.map((x, i) => h('div', { key: x.day + x.bvid, 'data-bd-item': '' },
              // 封面走宿主代理（直连 i0.hdslb.com 会被防盗链挡，也等于把使用者 IP 交出去）
              i < 40 ? h('img', { 'data-bd-cover': '', src: API + '/cover?bv=' + x.bvid, loading: 'lazy', alt: '' }) : null,
              h('div', { 'data-bd-item-body': '' },
                h('div', { 'data-bd-item-t': '' },
                  h('a', { href: x.url, target: '_blank', rel: 'noreferrer' }, x.title)),
                h('div', { 'data-bd-item-n': '' },
                  `${x.day} · ${x.up} · `, x.picked ? '挑中了' : (x.status && /跳过/.test(x.status) ? '跳过' : '看过'), (x.delivered || x.commented) ? ' · 已发给你' : '',
                  x.tier ? h('span', { 'data-bd-tier': x.tier }, ' · ' + x.tier) : null),
                x.why ? h('div', { 'data-bd-item-why': '' }, x.why) : null))))
            : null,
          watchedRows !== null && watchedTotal > WATCH_PAGE ? h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: watchedOffset <= 0, onClick: () => onWatchPage(-WATCH_PAGE) }, '上一页'),
            h('div', { 'data-bd-note': '' }, `${watchedOffset + 1}–${Math.min(watchedOffset + WATCH_PAGE, watchedTotal)} / ${watchedTotal}`),
            h('button', { 'data-bd-btn': '', disabled: watchedOffset + WATCH_PAGE >= watchedTotal, onClick: () => onWatchPage(WATCH_PAGE) }, '下一页')) : null),

        h('div', { 'data-bd-sec': '', 'data-bd-group': 'adv', 'data-bd-away': tab === 'adv' ? undefined : '' },
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'diag', onClick: onDiagnose }, '复制诊断信息'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'selfcheck', onClick: onSelfCheck }, '环境自检'),
            h('div', { 'data-bd-note': '' }, '出问题时先点这两个：第一个把环境+日志拼成一段（已自动复制），第二个逐项告诉你哪一步不通。')),
          checks && checks.length ? h('div', { 'data-bd-list': '', 'data-bd-checks': '' },
            checks.map((x) => h('div', { key: x.name, 'data-bd-item': '', 'data-bd-item-t': '' },
              h('div', { 'data-bd-item-t': '' }, (x.ok ? '正常 · ' : '有问题 · ') + x.name),
              h('div', { 'data-bd-item-n': '' }, x.detail || ''),
              x.ok ? null : h('div', { 'data-bd-item-why': '' }, '怎么办：' + (x.fix || '把诊断信息发给作者'))))) : null,
          diag ? h('pre', { 'data-bd-pre': '' }, diag) : null,
          h('div',{'data-bd-h':''},'模型路由：刷视频与后台互动独立配置'),
          h('div',{'data-bd-note':''},'提供方(provider)、模型 ID 为空时继承 DSH 当前配置；思考深度为自由文本，按模型支持的原始格式填写。保存后下次启动 Agent 生效。'),
          ...[
            ['video','刷视频 / 视频分析'],['interaction','后台私信 / 评论互动']
          ].map(([prefix,title])=>h('div',{'data-bd-sub':'',key:prefix},
            h('div',{'data-bd-label':''},title),
            ...[
              [prefix+'ModelProvider','模型提供方 Provider（可留空）','如 deepseek-account'],
              [prefix+'ModelId','模型 ID（可留空）','如 deepseek-chat'],
              [prefix+'ReasoningEffort','思考深度（自由输入，可留空）','填写该模型支持的原始值']
            ].map(([key,label,placeholder])=>h('div',{key},
              h('div',{'data-bd-note':''},label),
              h('input',{'data-bd-input':'',value:(modelDraft||{})[key]??'',placeholder,
                onChange:e=>setModelDraft(old=>({...old,[key]:e.target.value})),
                onBlur:()=>patch({[key]:(modelDraft||{})[key]||'',clear:[key]},'模型参数 '+key)}))))),
          h('div',{'data-bd-note':''},'后台互动沿用原有统一批量生成队列：私信与评论共享一个互动模型，节省重复人设提示词。'),
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-h': '' }, '环境与账号'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'install', onClick: onInstall },
              st.venvReady ? '重装主依赖' : '装主依赖（建 venv）'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'check', onClick: onCheck }, '测一下'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'update', onClick: onCheckUpdate }, '检查更新'),
            newVer ? h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'upgrade', onClick: onUpgrade }, '一键升级到 v' + newVer) : null,
            h('button', { 'data-bd-btn': '', disabled: busy === 'login', onClick: onLoginStart }, '扫码登录'),
            h('div', { 'data-bd-note': '' },
              !st.venvReady ? (st.installFailed ? '上次没装成 → 看下面日志' : '还没装 → 先点「装主依赖」')
                : (st.loggedIn ? '装好了 → 下一步「扫码登录」' : '环境好了 → 点「扫码登录」'))),
          loginState ? h('div', { 'data-bd-msg': '', 'data-good': loginTone === 'good' ? '' : undefined, 'data-warn': loginTone === 'warn' ? '' : undefined }, loginState) : null,
          st.installTail ? h('div', null,
            h('div', { 'data-bd-note': '' }, st.installing ? '正在装主依赖（进度）：' : '主依赖的日志（B站 搜索 / 字幕 / 评论 用得到，末尾）：'),
            h('pre', { 'data-bd-pre': '' }, st.installTail)) : null,
          login?.qr ? h('div', { 'data-bd-qr': '' },
            h('img', { src: login.qr, alt: 'B站登录二维码' }),
            h('div', { 'data-bd-note': '' },
              '手机 B站 → 我的 → 扫一扫。',
              h('br'),
              '确认时选「记住我 / 长期」那张 —— 选 24 小时的话，明天就得重扫。')) : null),
          (Array.isArray(st.missingDeps) && st.missingDeps.length)
            ? h('div', { 'data-bd-note': '' }, '还缺这几项：' + st.missingDeps.join(' / ') + '（qrcode = 画登录二维码用的）—— 点一次「重装主依赖」就会补上')
            : null,

        /* ── 它是怎么干活的（给他看的） ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'adv', 'data-bd-away': tab === 'adv' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它的地盘'),
          h('div', { 'data-bd-kv': '' },
            `家目录：${st.home}`,
            h('br'),
            `今天的报告：${st.report}`),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'report', onClick: onShowReport },
              report !== null ? '收起报告' : '看今天的报告'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('out') }, '打开报告文件夹'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('home') }, '打开家目录'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'verify', onClick: onVerify },
              '复核评论'),
            h('button', { 'data-bd-btn': '', onClick: () => copyText(st.report) }, '复制报告路径')),
          report !== null ? h('pre', { 'data-bd-pre': '' }, report) : null),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-bili-scroll-plus')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-bili-scroll-plus: 设置页样式')

        // ⭐ 进「设置」：label 就是左侧导航里那一项（抄 dsh-meme 的写法）
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },
          () => h(Panel),
        ))

  // ⭐ 2026-10-20 实验：会话头第三个 tab（0.2.1 里这个槽位真实存在；老版本没有就静默跳过）
  try {
    slots.inject('conversation.view', () => slots.register({
      name: 'conversation.view',
      id: 'bili-watched',
      order: 20,
      label: '刷过的视频',
      scope: 'session',
    }, () => h(WatchTab)))
  } catch (e) { /* 没有这个槽位就算了 */ }
      },
    }
  },
})
