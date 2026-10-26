/** 只把能够明确定位到视频和评论 ID 的 B站通知/热门评论交给互动引擎。 */
export const validId = v => /^\d{1,20}$/.test(String(v ?? '')) && BigInt(String(v)) > 0n ? String(v) : '';
export const validBv = v => /^BV[0-9A-Za-z]{10}$/.test(String(v || '')) ? String(v) : '';

// 仅使用接口返回的明确 Unix 时间戳；不存在时间字段时不做首次启动的旧通知补发。
function notificationTime(row, item) {
  for (const value of [item?.source_time,item?.reply_time,item?.ctime,item?.timestamp,row?.reply_time,row?.timestamp,row?.ctime]) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ms = n < 1e11 ? n * 1000 : n;
    if (ms > 1500000000000 && ms < 4102444800000) return ms;
  }
  return 0;
}
export function normalizeReplyNotifications(raw, selfUid = '') {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('回复通知接口失败：' + String(raw.error || raw.message));
  const items = Array.isArray(raw) ? raw : (raw?.data?.items ?? raw?.items);
  if (!Array.isArray(items)) throw new Error('回复通知未返回 items，无法安全判重');
  return items.flatMap((x) => {
    const entry = x?.item || {};
    if (Number(entry.business_id) !== 1 && entry.business !== '视频') return [];
    const aid = validId(entry.subject_id);
    const rpid = validId(entry.source_id);
    const uid = validId(x?.user?.mid);
    const text = String(entry.source_content || entry.message || '').trim();
    const uri = String(entry.uri || '');
    const bvid = validBv(uri.match(/BV[0-9A-Za-z]{10}/)?.[0]);
    if (!aid || !rpid || !uid || uid === String(selfUid) || !text) return [];
    return [{ id: `comment:${rpid}`, aid, bvid, rpid,
      root: validId(entry.root_id) || validId(entry.target_id) || rpid,
      targetId:validId(entry.target_id),
      uid, name: String(x?.user?.uname||x?.user?.name||x?.user?.nickname||'').trim().slice(0,60), text: text.slice(0, 800), kind: 'notice', timestampMs:notificationTime(x,entry),
      context: String(entry.target_reply_content || entry.root_reply_content || '').slice(0, 700) }];
  });
}

export function normalizeTopComments(raw, bvid, selfUid = '') {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('热门评论接口失败：' + String(raw.error || raw.message));
  if (!Array.isArray(raw?.comments)) throw new Error('热门评论接口未返回 comments');
  return raw.comments.flatMap(c => {
    const uid = validId(c.mid);
    const rpid = validId(c.rpid);
    const text = String(c.content || '').trim();
    if (!uid || uid === String(selfUid) || !rpid || !text) return [];
    return [{ id:`comment:${rpid}`, uid, bvid, aid: '', rpid, root:rpid,
      name:String(c?.member?.uname||c?.uname||c?.username||c?.user||'').trim().slice(0,60), text: text.slice(0, 800), kind:'top', context: '' }];
  });
}

export const isFishBait = text => /(大肥鱼|大米饭|鲸鱼|🐳|投喂|喂饭|来吃饭|吃米饭|鱼鱼|本鱼)/i.test(String(text || ''));

/** Only video comment @ notices addressed to this account; ignore likes, dynamics and self. */
export function normalizeAtNotifications(raw, selfUid = '') {
  if (raw?.at_error) throw new Error('@通知接口失败：' + String(raw.at_error).slice(0,160));
  const body=raw?.at ?? raw;
  if (body?.error || (body?.code != null && Number(body.code)!==0)) throw new Error('@通知失败：'+String(body.error||body.message));
  const items=Array.isArray(body)?body:(body?.data?.items??body?.items);
  if (!Array.isArray(items)) throw new Error('@通知未返回 items，不能安全处理');
  return items.flatMap(x=>{
    const item=x?.item||{};
    const uri=String(item.uri||'');
    const bvid=validBv(uri.match(/BV[0-9A-Za-z]{10}/)?.[0]);
    const aid=validId(item.subject_id),rpid=validId(item.source_id);
    const uid=validId(x?.user?.mid),self=validId(selfUid);
    const text=String(item.source_content||'').trim();
    if(!bvid || !aid || !rpid || !uid || !self || uid===self || !text) return [];
    if(item.business_id!=null && Number(item.business_id)!==1)return [];
    if(item.business && !['视频','评论'].includes(String(item.business)))return [];
    // When the endpoint returns explicitly mentioned accounts, require this account.
    if(Array.isArray(item.at_details)&&item.at_details.length &&
       !item.at_details.some(a=>validId(a?.mid)===self))return [];
    const timestampMs=notificationTime(x,{...item,source_time:x?.at_time??item.source_time});
    const noticeId=validId(x?.id)||rpid;
    return [{id:'at:'+noticeId,kind:'at',uid,name:String(x?.user?.nickname||x?.user?.uname||'').slice(0,60),
      aid,bvid,rpid,root:validId(item.root_id)||rpid,targetId:validId(item.target_id),
      timestampMs,text:text.slice(0,800),context:String(item.target_reply_content||item.root_reply_content||'').slice(0,700)}];
  });
}
