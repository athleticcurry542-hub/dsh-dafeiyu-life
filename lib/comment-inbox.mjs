/** 只把能够明确定位到视频和评论 ID 的 B站通知/热门评论交给互动引擎。 */
export const validId = v => /^\d{1,20}$/.test(String(v ?? '')) && BigInt(String(v)) > 0n ? String(v) : '';
export const validBv = v => /^BV[0-9A-Za-z]{10}$/.test(String(v || '')) ? String(v) : '';

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
      uid, text: text.slice(0, 800), kind: 'notice',
      context: String(entry.target_reply_content || entry.root_reply_content || '').slice(0, 200) }];
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
      text: text.slice(0, 800), kind:'top', context: '' }];
  });
}

export const isFishBait = text => /(大肥鱼|大米饭|鲸鱼|🐳|投喂|喂饭|来吃饭|吃米饭|鱼鱼|本鱼)/i.test(String(text || ''));
