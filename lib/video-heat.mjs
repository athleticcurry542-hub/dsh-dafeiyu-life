/** 公开原创选片质量检查；不影响回复现有评论。严格区分「没返回数据」和数值 0。 */
const int=(x)=>typeof x==='number'&&Number.isFinite(x)&&x>=0?Math.floor(x):
  (typeof x==='string'&&/^\d+$/.test(x.trim())?Number(x.trim()):null);
export function judgeVideoHeat(info, limits={}) {
  const stat=info&&typeof info==='object'?info.stat:null;
  const fields=[['view','播放量',limits.views],['like','点赞数',limits.likes],['reply','评论数',limits.replies]];
  const stats={};
  const missing=[],low=[];
  for(const [key,label,limit] of fields){
    const value=int(stat?.[key]);stats[key]=value;
    const min=int(limit)??0;
    if(min>0 && value===null)missing.push(label);
    else if(min>0 && value<min)low.push(`${label} ${value}＜${min}`);
  }
  const reason=missing.length?`未取得${missing.join('、')}，请跳过该视频`:
    low.length?low.join('；'):'达标';
  return {ok:missing.length===0&&low.length===0,reason,stats};
}
