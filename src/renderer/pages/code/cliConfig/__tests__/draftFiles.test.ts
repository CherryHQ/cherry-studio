import type { CliConfigTarget } from '@shared/utils/cliConfig'
import { describe, expect, it } from 'vitest'

import { readAndParseDraftFile, validateCliConfigDraftForWrite } from '../draftFiles'
import { type CliConfigReadFiles, parseTomlOrThrow } from '../file'
import type { CliConfigFileDraft } from '../types'

function readWith(target: CliConfigTarget, content: string | null): CliConfigReadFiles {
  return new Map([[target, { path: `/resolved${target}`, content }]])
}

describe('readAndParseDraftFile (secret redaction on parse failure)', () => {
  it('does not leak the raw secret from a malformed TOML file into the thrown error', () => {
    const read = readWith('kimi-config', 'api_key = "sk-ant-real-secret"\nbroken=====')
    expect(() => readAndParseDraftFile('kimi-config', parseTomlOrThrow, undefined, read)).toThrow(
      /Failed to parse .*api_key = "<redacted>"/s
    )
    expect(() => readAndParseDraftFile('kimi-config', parseTomlOrThrow, undefined, read)).not.toThrow(
      /sk-ant-real-secret/
    )
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
