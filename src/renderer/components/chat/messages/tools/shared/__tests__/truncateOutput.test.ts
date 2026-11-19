import { describe, expect, it } from 'vitest'

import { countLines, truncateOutput } from '../truncateOutput'

describe('tool output text fallback', () => {
  it('contains a throwing content getter without showing its private error text', () => {
    const output = Object.defineProperty({}, 'content', {
      enumerable: true,
      get() {
        throw new Error('private tool payload')
      }
    })

    expect(truncateOutput(output).data).toBe('[Unserializable]')
    expect(countLines(output)).toBe(1)
  })

  it('keeps tool output renderable when both JSON serialization and string coercion throw', () => {
    const output = {
      toJSON() {
        throw new Error('cannot serialize tool output')
      },
      toString() {
        throw new Error('cannot coerce tool output')
      }
    }

    expect(truncateOutput(output).data).toBe('[Unserializable]')
    expect(countLines(output)).toBe(1)
  })
})
