/** White-lists accept UID, UID|备注昵称; nickname never used as an auth identity. */
export function readUidList(value) {
  const out = new Map();
  for (const item of String(value||'').split(/[\r\n,，;；]+/).flatMap(line => line.includes('|') ? [line] : line.split(/\s+/))) {
    const [uid,label=''] = item.trim().split('|');
    if (/^[1-9]\d{0,18}$/.test(uid)) out.set(uid, label.replace(/[<>\x00-\x1f]/g,'').slice(0,40));
  }
  return out;
}
export const normalizeUidList = value => [...readUidList(value)].map(([uid,label])=>uid+(label?'|'+label:'')).join('\n');
