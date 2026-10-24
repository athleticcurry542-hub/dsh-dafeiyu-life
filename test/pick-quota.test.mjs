import test from 'node:test'
import assert from 'node:assert/strict'
import { picksThisRound } from '../lib/pick-quota.mjs'

test('一轮选片上限和每日额度独立', () => {
  assert.equal(picksThisRound(20, 5, 0), 5)
  assert.equal(picksThisRound(20, 5, 5), 5)
  assert.equal(picksThisRound(20, 5, 17), 3)
  assert.equal(picksThisRound(20, 5, 20), 0)
  assert.equal(picksThisRound(20, 5, 30), 0)
})

test('老配置兼容：每轮默认五条、允许填 1 到 50', () => {
  assert.equal(picksThisRound(50, undefined, 0), 5)
  assert.equal(picksThisRound(20, 1, 0), 1)
  assert.equal(picksThisRound(50, 1000, 0), 50)
  assert.equal(picksThisRound(50, 0, 0), 5)
})

test('每日额度为零时本轮也必须为零', () => {
  assert.equal(picksThisRound(0, 5, 0), 0)
  assert.equal(picksThisRound(-1, 5, 0), 0)
})
