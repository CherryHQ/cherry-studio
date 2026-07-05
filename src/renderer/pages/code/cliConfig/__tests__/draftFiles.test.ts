import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readAndParseDraftFile } from '../draftFiles'
import { parseTomlOrThrow } from '../file'

describe('readAndParseDraftFile (secret redaction on parse failure)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
        file: {
          readExternal: vi.fn(async () => 'api_key = "sk-ant-real-secret"\nbroken=====')
        }
      }
    })
  })

  it('does not leak the raw secret from a malformed TOML file into the thrown error', async () => {
    await expect(readAndParseDraftFile('kimi-config', parseTomlOrThrow)).rejects.toThrow(
      /Failed to parse .*api_key = "<redacted>"/s
    )
    await expect(readAndParseDraftFile('kimi-config', parseTomlOrThrow)).rejects.not.toThrow(/sk-ant-real-secret/)
  })
})
