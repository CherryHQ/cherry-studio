import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readAndParseDraftFile, validateCliConfigDraftForWrite } from '../draftFiles'
import { parseTomlOrThrow } from '../file'
import type { CliConfigFileDraft } from '../types'

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

describe('validateCliConfigDraftForWrite (secret redaction when editing config text directly)', () => {
  it('does not leak the raw secret from a malformed in-editor TOML draft into the thrown error', () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'kimi-config',
        label: 'Kimi config',
        path: '/resolved~/.kimi-code/config.toml',
        language: 'toml',
        content: 'api_key = "sk-ant-real-secret"\nbroken====='
      }
    ]
    expect(() => validateCliConfigDraftForWrite(files)).toThrow(/api_key = "<redacted>"/)
    expect(() => validateCliConfigDraftForWrite(files)).not.toThrow(/sk-ant-real-secret/)
  })
})
