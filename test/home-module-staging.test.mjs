import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureHomeFiles } from '../lib/state.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const shippedHelper = join(root, 'vendor', 'bilibili-mcp', 'home_recommendations.py')

const withStateDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-home-staging-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('install stages the homepage recommendation helper next to mcp_server.py for Python imports', () => withStateDir((dir) => {
  ensureHomeFiles(root, dir)
  const dst = join(dir, 'home_recommendations.py')
  assert.ok(existsSync(dst), 'home_recommendations.py must exist in the Python MCP runtime folder')
  assert.equal(readFileSync(dst, 'utf8'), readFileSync(shippedHelper, 'utf8'))
  assert.ok(existsSync(join(dir, 'mcp_server.py')))
  assert.ok(existsSync(join(dir, '.shipped-home_recommendations.py.sha')))
}))

test('upgrade stages missing helper even when mcp_server.py was already present', () => withStateDir((dir) => {
  writeFileSync(join(dir, 'mcp_server.py'), readFileSync(join(root, 'vendor', 'bilibili-mcp', 'mcp_server.py')))
  ensureHomeFiles(root, dir)
  assert.ok(existsSync(join(dir, 'home_recommendations.py')))
}))

test('edited home recommendation helper is preserved, with new version staged separately', () => withStateDir((dir) => {
  ensureHomeFiles(root, dir)
  const dst = join(dir, 'home_recommendations.py')
  writeFileSync(dst, '# intentionally user-edited helper\n')
  ensureHomeFiles(root, dir)
  assert.equal(readFileSync(dst, 'utf8'), '# intentionally user-edited helper\n')
  assert.equal(readFileSync(dst + '.new', 'utf8'), readFileSync(shippedHelper, 'utf8'))
}))
