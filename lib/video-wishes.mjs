/** 临时视频心愿：仅获批私信用户的明确请求，默认最多 @ 3 次。 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOPICS = [
  ['美食',/美食|好吃|吃的|好喝|做饭|食谱|烹饪|探店|甜品|零食|烧烤|火锅|奶茶/],
  ['游戏',/游戏|电竞|王者|原神|崩铁|绝区零|通关/],
  ['宠物',/宠物|猫咪|狗狗|萌宠|毛孩子/],
  ['科技',/科技|电脑|编程|AI|人工智能|手机|硬件|数码|机器人/i],
  ['音乐',/音乐|歌曲|唱歌|演唱|乐器/],
  ['旅行',/旅游|旅行|风景|景点|徒步|露营/],
  ['动画',/动画|动漫|番剧|二次元/],
  ['运动',/运动|健身|篮球|足球|跑步|瑜伽/],
];
const cancel = /(?:不要|别|取消|停止|不想|不需要).{0,9}(?:找视频|推荐|@|艾特|提醒|心愿)/;
const request = /(?:帮我|给我|替我|求|可以|能不能|想|想要|想看|找|推荐|有没有|来点|整点|蹲).{0,25}(?:视频|看的|好吃|美食|游戏|科技|宠物|音乐|旅行|动画|运动|推荐|找点|找些)|(?:找|推荐|蹲).{0,15}(?:美食|好吃|视频|番剧|宠物|游戏|音乐|科技|旅行)|(?:有没有|有啥).{0,25}(?:视频|推荐)/;
export function parseVideoWish(text) {
  const t=String(text||'').trim().slice(0,180);
  if (cancel.test(t)) return {cancel:true};
  if (!request.test(t)) return null;
  const found=TOPICS.filter(([,re])=>re.test(t)).map(([topic])=>topic);
  // 未知主题不能从任意私信自动创建 @ 任务；需要用户明确描述已支持的主题。
  if (!found.length) return null;
  return {topic:found[0]};
}
export function updateVideoWishes(person, text, {uid, messageId, now=Date.now(), limit=3}={}) {
  const match=parseVideoWish(text);
  if (!match) return null;
  const list=Array.isArray(person.videoWishes)?person.videoWishes:[];
  if (match.cancel) {
    for (const item of list) if(item.status==='active')item.status='cancelled';
    person.videoWishes=list;return {cancelled:true};
  }
  if (!person.approval || person.approval.status!=='approved') return null;
  const topic=match.topic;
  for (const item of list) if(item.status==='active'&&item.topic===topic) return {existing:true,topic};
  const record={id:randomUUID(),uid:String(uid),topic,status:'active',limit:Math.max(1,Math.min(10,Math.floor(+limit)||3)),
    createdAt:now,expiresAt:now+30*86400_000,sourceMessageId:String(messageId||'').slice(0,150)};
  list.push(record);
  // 限制每人同时存在的心愿，超过时取消最旧的；旧记录保留供审计。
  const active=list.filter(x=>x.status==='active');
  for(const old of active.slice(0,Math.max(0,active.length-3)))old.status='cancelled';
  person.videoWishes=list.slice(-30);
  return {created:true,topic,record};
}
export function getWishUsage(home, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return {accepted:0,reserved:0};
  const dir=join(home,'video-wish-claims');let files=[];
  try {files=readdirSync(dir).filter(x=>x.startsWith(id+'--')&&x.endsWith('.json')).slice(0,150)}catch{return {accepted:0,reserved:0}}
  let accepted=0,reserved=0;
  for (const name of files) try {
    const data=JSON.parse(readFileSync(join(dir,name),'utf8'));
    if(data.id!==id)continue;
    if(data.status==='accepted')accepted++;
    if(data.status==='reserved'||data.status==='uncertain')reserved++;
  }catch{}
  return {accepted,reserved};
}
export function listActiveVideoWishes(db,home,now=Date.now(),{limit=60}={}) {
  const wishes=[];
  for(const [uid,person] of Object.entries(db.people||{})) {
    if(!/^[1-9]\d{0,18}$/.test(uid)||person?.approval?.status!=='approved')continue;
    for(const w of Array.isArray(person.videoWishes)?person.videoWishes:[]) {
      if(w.status!=='active'||!w.expiresAt||w.expiresAt<=now)continue;
      const usage=getWishUsage(home,w.id);
      if(usage.accepted>=w.limit)continue;
      wishes.push({...w,remaining:Math.max(0,w.limit-usage.accepted-usage.reserved),accepted:usage.accepted,reserved:usage.reserved});
    }
  }
  return wishes.sort((a,b)=>a.createdAt-b.createdAt).slice(0,limit);
}
