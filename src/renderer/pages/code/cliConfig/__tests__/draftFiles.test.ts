import { describe, expect, it } from 'vitest'

import type { CliConfigTarget } from '@shared/utils/cliConfig'

import { readAndParseDraftFile, validateCliConfigDraftForWrite } from '../draftFiles'
import { type CliConfigReadFiles, parseTomlOrThrow, parseYamlOrThrow } from '../file'
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

  it('does not leak the raw secret from a malformed YAML file into the thrown error', () => {
    const read = readWith('hermes-config', 'api_key: sk-ant-real-secret\n  malformed: yaml')
    expect(() => readAndParseDraftFile('hermes-config', parseYamlOrThrow, undefined, read)).toThrow(/Failed to parse/)
    expect(() => readAndParseDraftFile('hermes-config', parseYamlOrThrow, undefined, read)).not.toThrow(
      /sk-ant-real-secret/
    )
  })
})

describe('parseYamlOrThrow', () => {
  it.each(['', '# user comment\n', 'null\n', '~\n'])('treats %j as an empty mapping', (content) => {
    expect(parseYamlOrThrow(content)).toEqual({})
  })

  it.each(['- a\n', 'plain scalar\n'])('rejects non-mapping YAML roots: %j', (content) => {
    expect(() => parseYamlOrThrow(content)).toThrow('invalid YAML root: expected an object')
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

  it('validates YAML drafts before writing', () => {
    const files: CliConfigFileDraft[] = [
      {
        target: 'hermes-config',
        label: 'Hermes config',
        path: '/resolved-hermes/config.yaml',
        language: 'yaml',
        content: 'api_key: sk-ant-real-secret\n  malformed: yaml'
      }
    ]
    expect(() => validateCliConfigDraftForWrite(files)).toThrow(/<redacted>/)
    expect(() => validateCliConfigDraftForWrite(files)).not.toThrow(/sk-ant-real-secret/)
  })
})
