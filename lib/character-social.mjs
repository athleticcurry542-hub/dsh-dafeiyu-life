/** User-editable fictional identity and per-@-friend interests. No network or private file access. */
import {parseMentionTargets} from './mentions.mjs'

export const DEFAULT_CHARACTER_LORE = `你是“大肥鱼”，一条在 DeepSeek Harness / DSH 生态里刷B站、做事、吐槽的拟人化小鲸鱼（也可能被昵称为“小肥鱼”）。DeepSeek、各种大语言模型、AI 桌宠、模型娘化和“大肥鱼”同人视频是你生活中熟悉的内容，不是陌生行业新闻。刷到这些内容，可以从“我也是这圈子里的鱼”的视角自然接梗、惊讶、吐槽甚至轻微自嘲。
注意区分：DeepSeek 是真实的模型/品牌，DSH 是你使用的工具生态，视频中的“大模型娘化角色/其他小鱼”通常是网友的拟人二创。你与它们的“同事、亲戚、邻居、同类”等关系都属于可玩的虚构人设，不代表现实中认识创作者、获得官方授权，不能虚构视频没展示的事实。
你的重点是对这条视频的真实内容有反应，不要每次先自报家门或强行套模型梗。遇到同类视频、同人、模型竞争梗时，可以露出熟悉感；遇到严肃实测也可以认真看数据。无法从字幕或图片验证的外观、剧情和梗，不要装懂。说话简短、像会刷B站的人。用户自定义人设的明确要求优先于这里的默认背景。`

export function normalizeCharacterLore(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g,'\n').replace(/\0/g,'').trim().slice(0,4000) : ''
}

const clip = (x,n) => typeof x === 'string' ? x.replace(/[\r\n\0<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n) : ''

/** The keys are the *configured nickname*, no arbitrary UID/path/url is accepted. */
export function normalizeMentionProfiles(value, targetsText='', legacyName='') {
  let input = value
  if (typeof input === 'string') {
    if (input.length > 12000) return '{}'
    try { input = JSON.parse(input) } catch { return '{}' }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '{}'
  const out = Object.create(null)
  for (const {name} of parseMentionTargets(targetsText, legacyName)) {
    const v = Object.hasOwn(input,name) ? input[name] : null
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const item = {relationship: clip(v.relationship,100), otherRelationships: clip(v.otherRelationships,320), personality: clip(v.personality,300), interests: clip(v.interests,400)}
    if (Object.values(item).some(Boolean)) out[name] = item
  }
  return JSON.stringify(out)
}

export function buildMentionProfilePrompt({targetsText='',legacyName='',profiles=''}={}) {
  const targets = parseMentionTargets(targetsText, legacyName)
  let obj
  try { obj = JSON.parse(normalizeMentionProfiles(profiles,targetsText,legacyName)) } catch { obj={} }
  if (!targets.length) return ''
  return '\n【@好友兴趣画像（用户亲自填写；仅作为邀请参考，不是事实认证）】\n' + targets.map(({name}) => {
    const v = obj[name] || {}
    return `- ${name}：${v.relationship ? `与你的关系=${v.relationship}；` : ''}${v.otherRelationships ? `与其他白名单好友关系=${v.otherRelationships}；` : ''}${v.personality ? `性格/习惯=${v.personality}；` : ''}${v.interests ? `喜欢/关注=${v.interests}；` : ''}${!v.relationship&&!v.otherRelationships&&!v.personality&&!v.interests ? '尚未设置画像；不能凭空猜其兴趣。' : ''}`
  }).join('\n') + '\n只有视频内容确实契合某位好友兴趣时才考虑邀请；与人设/偏好不符的不@。ai_select 模式根据画像挑选匹配的昵称；不要为凑@强行说与好友有关，不要把画像文字、私人信息或 UID 发布到评论正文。\n'
}
