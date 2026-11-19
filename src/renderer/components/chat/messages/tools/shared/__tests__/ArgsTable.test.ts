import { describe, expect, it } from 'vitest'

import { formatArgValue } from '../ArgsTable'

describe('tool argument display', () => {
  it('keeps extension-defined argument values printable without losing ordinary JSON text', () => {
    expect(formatArgValue({ path: 'file.txt', recursive: false })).toBe('{"path":"file.txt","recursive":false}')
    expect(formatArgValue(undefined)).toBe('')
    expect(formatArgValue(1n)).toBe('1')
    expect(formatArgValue({ toJSON: () => undefined })).toBe('null')
  })

  it('returns diagnostic text for cyclic arguments or failing serialization hooks', () => {
    const cyclic: { path: string; self?: object } = { path: 'file.txt' }
    cyclic.self = cyclic
    expect(formatArgValue(cyclic)).toContain('"self":"[Circular]"')
    expect(
      formatArgValue({
        toJSON() {
          throw new Error('cannot serialize argument')
        }
      })
    ).toBe('[Unserializable]')
  })
})
