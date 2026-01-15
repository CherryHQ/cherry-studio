import { describe, expect, it } from 'vitest'

import { ServerLogBuffer } from '../mcp/ServerLogBuffer'

describe('ServerLogBuffer', () => {
  it('keeps a bounded number of entries per server', () => {
    const buffer = new ServerLogBuffer(3)
    const key = 'srv'

    buffer.append(key, { timestamp: 1, level: 'info', message: 'a' })
    buffer.append(key, { timestamp: 2, level: 'info', message: 'b' })
    buffer.append(key, { timestamp: 3, level: 'info', message: 'c' })
    buffer.append(key, { timestamp: 4, level: 'info', message: 'd' })

    const logs = buffer.get(key)
    expect(logs).toHaveLength(3)
    expect(logs[0].message).toBe('b')
    expect(logs[2].message).toBe('d')
  })

  it('isolates entries by server key', () => {
    const buffer = new ServerLogBuffer(5)
    buffer.append('one', { timestamp: 1, level: 'info', message: 'a' })
    buffer.append('two', { timestamp: 2, level: 'info', message: 'b' })

    expect(buffer.get('one')).toHaveLength(1)
    expect(buffer.get('two')).toHaveLength(1)
  })
})
