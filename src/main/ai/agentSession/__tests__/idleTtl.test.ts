import { expect, it } from 'vitest'

import { resolveAgentIdleTtlMs } from '../idleTtl'

it.each([
  [0, 0],
  [0.5, 30_000],
  [5, 300_000],
  [12, 720_000],
  [100_000, 2_147_483_647]
])('resolves idle TTL %s without overflowing a Node timer', (minutes, expected) => {
  expect(resolveAgentIdleTtlMs(minutes)).toBe(expected)
})

it.each([NaN, Infinity, -Infinity, -1])('keeps the historical default for invalid idle TTL %s', (minutes) => {
  expect(resolveAgentIdleTtlMs(minutes)).toBe(300_000)
})
