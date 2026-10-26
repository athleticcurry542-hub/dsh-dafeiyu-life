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

/** 只在 B站通知已给出真实 AID 时反算 BV；不从昵称、标题猜视频。 */
export function avToBv(aid) {
  if (!/^[1-9]\d{0,19}$/.test(String(aid??''))) return '';
  const id=BigInt(String(aid));
  if (id > MASK) return '';
  let n=(id ^ XOR) | (1n<<51n);
  const digits=Array(9).fill('');
  for(let i=8;i>=0;i--){digits[i]=ALPHABET[Number(n%58n)];n/=58n;}
  if (n) return '';
  const chars=[...'BV1',...digits];
  [chars[4],chars[7]]=[chars[7],chars[4]];
  [chars[3],chars[9]]=[chars[9],chars[3]];
  const candidate=chars.join('');
  return bvToAv(candidate)===String(id)?candidate:'';
}
