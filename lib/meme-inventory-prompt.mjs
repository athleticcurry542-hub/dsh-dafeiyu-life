/** 从真实已校验名称构建多分类均衡清单；不猜测图片内容。 */
export function buildBalancedMemeInventory(lib,{limit=45}={}){
  if(!lib?.ok)return null
  const names=Array.isArray(lib.names)?lib.names.filter(s=>typeof s==='string'):[]
  if(!names.length)return '图库目前没有可用图片'
  const max=Math.max(1,Math.min(60,Math.floor(Number(limit)||45)))
  const groups=new Map()
  for(const name of names){
    const key=name.includes('/')?name.split('/')[0]:'根目录'
    if(!groups.has(key))groups.set(key,[])
    groups.get(key).push(name)
  }
  const out=[]
  for(let i=0;out.length<max;i++){
    let added=false
    for(const group of groups.values()){
      if(i<group.length && out.length<max){out.push('• '+group[i]);added=true}
    }
    if(!added)break
  }
  return out.join('\n')+(lib.total>out.length?'\n（这里只是部分可用图片；更多请调用 bili_comment_meme_search 按评论关键词检索，或 bili_comment_meme_list 查询分类）':'')
}
