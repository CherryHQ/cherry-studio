import { expect, it } from 'vitest'

import { normalizeWebviewAddress } from '../normalizeWebviewAddress'

it.each([
  ['example.com:8080/path', 'https://example.com:8080/path'],
  ['localhost:3000', 'http://localhost:3000/'],
  ['127.0.0.1:9000/x', 'http://127.0.0.1:9000/x'],
  ['::1', 'http://[::1]/'],
  ['::1/path?x=1#section', 'http://[::1]/path?x=1#section'],
  ['::1?x=1', 'http://[::1]/?x=1'],
  ['::1#section', 'http://[::1]/#section'],
  ['[::1]', 'http://[::1]/'],
  ['http://[::1]/status', 'http://[::1]/status'],
  ['https://[::1]:3000/status', 'https://[::1]:3000/status'],
  ['::1:3000', null],
  ['::1evil', null],
  ['[::1', null],
  ['::1]', null],
  ['data:text/plain,hello', null],
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
