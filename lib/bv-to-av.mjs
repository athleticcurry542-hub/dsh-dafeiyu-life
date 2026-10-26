/** B站公开 BV/AV 转换；只用于展示，不改变发送和评论跳转协议。 */
const ALPHABET='FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
const XOR=23442827791579n;
const MASK=(1n<<51n)-1n;
export function bvToAv(bv) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bv||''))) return '';
  const chars=[...bv];
  [chars[3],chars[9]]=[chars[9],chars[3]];
  [chars[4],chars[7]]=[chars[7],chars[4]];
  let n=0n;
  for(const c of chars.slice(3)){
    const v=ALPHABET.indexOf(c);
    if(v<0)return '';
    n=n*58n+BigInt(v);
  }
  const aid=(n&MASK)^XOR;
  return aid>0n?String(aid):'';
}
