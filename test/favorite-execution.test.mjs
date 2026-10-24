import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const root = new URL('../', import.meta.url)
const app = readFileSync(new URL('index.js', root), 'utf8')
const ui = readFileSync(new URL('client.js', root), 'utf8')
const py = readFileSync(new URL('lib/favops.py', root), 'utf8')

test('video favorite sidecar uses supported SDK method', () => {
  assert.match(py, /v\.set_favorite\(add_media_ids=\[int\(fid\)\]\)/)
  assert.doesNotMatch(py, /await favorite_list\.FavoriteListResource|await favorite_list\.FavoriteList\(/)
})
test('failed favorites show first actual failure and a warning', () => {
  assert.match(app, /首条：\$\{failures\[0\]\}/)
  assert.match(ui, /收藏未全部成功/)
  assert.match(ui, /'warn'/)
})
test('stop on systemic error rather than retry all 30 videos', () => {
  assert.match(app, /stoppedEarly = true/)
  assert.match(app, /break\s*\n\s*}/)
})
