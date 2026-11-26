import { expect, it } from 'vitest'

import { terminalRequestSchemas } from '../terminal'

const input = {
  viewId: '11111111-1111-4111-8111-111111111111',
  rowStart: 0,
  revision: null
}

it.each([5001, 20000, 1000000])('admits scrolling through retained terminal history at offset %i', (offset) => {
  expect(terminalRequestSchemas['terminal.frame'].input.safeParse({ ...input, offset }).success).toBe(true)
})

it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid terminal history offset %s', (offset) => {
  expect(terminalRequestSchemas['terminal.frame'].input.safeParse({ ...input, offset }).success).toBe(false)
})
