import { expect, it } from 'vitest'

import { normalizeWebviewAddress } from '../normalizeWebviewAddress'

it.each([
  ['example.com:8080/path', 'https://example.com:8080/path'],
  ['localhost:3000', 'http://localhost:3000/'],
  ['127.0.0.1:9000/x', 'http://127.0.0.1:9000/x'],
  ['[::1]:3000', 'http://[::1]:3000/'],
  ['  example.com  ', 'https://example.com/'],
  ['file:///tmp/page%20one.html', 'file:///tmp/page%20one.html'],
  ['file:///C:/project/index.html', 'file:///C:/project/index.html'],
  ['javascript:alert(1)', null],
  ['custom:page', null],
  ['', null]
])('normalizes the same address for browser and MiniApp: %s', (input, expected) => {
  expect(normalizeWebviewAddress(input)).toBe(expected)
})
