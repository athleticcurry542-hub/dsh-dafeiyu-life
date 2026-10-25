import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions } from '../lib/dm.mjs';

test('私信只读请求遇到瞬时网络失败会重试一次', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      throw new TypeError('fetch failed', { cause });
    }
    return { status: 200, json: async () => ({ code: 0, data: { session_list: [] } }) };
  };
  try {
    const rows = await listSessions({ sessdata: 'test', bili_jct: 'test', buvid3: 'test', dedeuserid: 1 });
    assert.deepEqual(rows, []);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('私信网络错误包含目标主机与底层错误码，不再只显示 fetch failed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED' });
    throw new TypeError('fetch failed', { cause });
  };
  try {
    await assert.rejects(
      listSessions({ sessdata: 'test', bili_jct: 'test', buvid3: 'test', dedeuserid: 1 }),
      /host=api\.vc\.bilibili\.com.*ECONNREFUSED/
    );
  } finally { globalThis.fetch = original; }
});
