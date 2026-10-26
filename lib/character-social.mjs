/** User-editable fictional identity and per-@-friend interests. No network or private file access. */
import {parseMentionTargets} from './mentions.mjs'
import {normalizeFriendDirectory} from './friend-directory.mjs'

export const DEFAULT_CHARACTER_LORE = `你是“大肥鱼”，一条在 DeepSeek Harness / DSH 生态里刷B站、做事、吐槽的拟人化小鲸鱼（也可能被昵称为“小肥鱼”）。DeepSeek、各种大语言模型、AI 桌宠、模型娘化和“大肥鱼”同人视频是你生活中熟悉的内容，不是陌生行业新闻。刷到这些内容，可以从“我也是这圈子里的鱼”的视角自然接梗、惊讶、吐槽甚至轻微自嘲。
注意区分：DeepSeek 是真实的模型/品牌，DSH 是你使用的工具生态，视频中的“大模型娘化角色/其他小鱼”通常是网友的拟人二创。你与它们的“同事、亲戚、邻居、同类”等关系都属于可玩的虚构人设，不代表现实中认识创作者、获得官方授权，不能虚构视频没展示的事实。
你的重点是对这条视频的真实内容有反应，不要每次先自报家门或强行套模型梗。遇到同类视频、同人、模型竞争梗时，可以露出熟悉感；遇到严肃实测也可以认真看数据。无法从字幕或图片验证的外观、剧情和梗，不要装懂。说话简短、像会刷B站的人。用户自定义人设的明确要求优先于这里的默认背景。`

export function normalizeCharacterLore(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g,'\n').replace(/\0/g,'').trim().slice(0,4000) : ''
}

const clip = (x,n) => typeof x === 'string' ? x.replace(/[\r\n\0<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n) : ''

/** The keys are the *configured nickname*, no arbitrary UID/path/url is accepted. */
export function normalizeMentionProfiles(value, targetsText='', legacyName='', friendDirectory='') {
  let input=value
  if(typeof input==='string') {if(input.length>20000)return '{}';try{input=JSON.parse(input)}catch{return '{}'}}
  if(!input||typeof input!=='object'||Array.isArray(input))return '{}'
  let directory=[];try{directory=JSON.parse(normalizeFriendDirectory(friendDirectory))}catch{}
  const allowed=new Map()
  for(const row of directory)allowed.set(row.uid,row)
  for(const row of parseMentionTargets(targetsText,legacyName))if(row.uid&&!allowed.has(row.uid))allowed.set(row.uid,{uid:row.uid,name:row.name})
  const out=Object.create(null)
  for(const row of allowed.values()) {
    const v=input[row.uid]||input[row.name]||input['UID '+row.uid]
    if(!v||typeof v!=='object'||Array.isArray(v))continue
    const peers=Array.isArray(v.peerRelationships) ? v.peerRelationships : []
    const peerRelationships=peers.filter(x=>x&&allowed.has(String(x.uid||''))&&String(x.uid)!==row.uid).slice(0,30).map(x=>({uid:String(x.uid),relationship:clip(x.relationship,120)})).filter(x=>x.relationship)
    const item={relationship:clip(v.relationship,100),role:v.role==='owner'?'owner':'friend',peerRelationships,personalityInterests:clip(v.personalityInterests,700)||[clip(v.personality,300),clip(v.interests,400)].filter(Boolean).join('；'),otherRelationships:clip(v.otherRelationships,320)}
    if(item.relationship||item.role==='owner'||item.peerRelationships.length||item.personalityInterests||item.otherRelationships)out[row.uid]=item
  }
  return JSON.stringify(out)
}

export function buildMentionProfilePrompt({targetsText='',legacyName='',profiles='',friendDirectory=''}={}) {
  const targets=parseMentionTargets(targetsText,legacyName)
  let obj={};try{obj=JSON.parse(normalizeMentionProfiles(profiles,targetsText,legacyName,friendDirectory))}catch{}
  if(!targets.length)return ''
  let directory=[];try{directory=JSON.parse(normalizeFriendDirectory(friendDirectory))}catch{}
  const names=new Map(directory.map(r=>[r.uid,r.name||('UID '+r.uid)]))
  return '\n【@好友画像（用户填写，仅用于决定是否邀请，不是事实认证）】\n' + targets.map(({name,uid})=>{
    const v=obj[uid]||obj[name]||{}
    const peers=(v.peerRelationships||[]).map(x=>(names.get(x.uid)||'一位白名单好友')+'='+x.relationship).join('；')
    return `- ${name}：${v.role==='owner'?'与大肥鱼的角色=主人；':''}${v.relationship?'与大肥鱼关系='+v.relationship+'；':''}${peers?'与其他好友的关系='+peers+'；':''}${v.personalityInterests?'性格爱好='+v.personalityInterests+'；':''}${v.otherRelationships?'旧关系备注='+v.otherRelationships+'；':''}${!v.relationship&&!peers&&!v.personalityInterests&&!v.otherRelationships?'未设置画像；不能臆造兴趣。':''}`
  }).join('\n')+'\n仅当视频真实内容契合才考虑 @；昵称只是显示标签，不能替代 UID 做权限判断。主人仅为预留角色标签，不授予管理权限。\n'
}
