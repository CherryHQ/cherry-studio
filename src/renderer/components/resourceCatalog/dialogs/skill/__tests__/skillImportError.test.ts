import { describe, expect, it } from 'vitest'

import { getSkillImportErrorMessage } from '../skillImportError'

const t = (key: string, options: { name: string }) => `${key}:${options.name}`

describe('getSkillImportErrorMessage', () => {
  it.each([
    {
      name: 'a ZIP without a skill directory',
      error: new Error('No skill directory found in /tmp/CherryStudio/skill-install/zip-install-123'),
      kind: 'zip' as const,
      expectedKey: 'settings.skills.zipImportFailed'
    },
    {
      name: 'a directory without SKILL.md',
      error: new Error('SKILL.md or skill.md not found in skill folder'),
      kind: 'directory' as const,
      expectedKey: 'settings.skills.directoryImportFailed'
    },
    {
      name: 'an existing folder-name conflict',
      error: new Error('Folder name "my-skill" is already used by a local skill; refusing to overwrite it.'),
      kind: 'directory' as const,
      expectedKey: 'settings.skills.importConflict'
    },
    {
      name: 'a ZIP exceeding the extraction limit',
      error: new Error('ZIP too large: 104857601 bytes exceeds 104857600'),
      kind: 'zip' as const,
      expectedKey: 'settings.skills.zipTooLarge'
    },
    {
      name: 'a ZIP containing too many files',
      error: new Error('ZIP has too many files: 10001 exceeds 10000'),
      kind: 'zip' as const,
      expectedKey: 'settings.skills.zipTooManyFiles'
    }
  ])('maps $name to localized guidance', ({ error, kind, expectedKey }) => {
    expect(getSkillImportErrorMessage(error, { kind, name: 'broken-skill' }, t)).toBe(`${expectedKey}:broken-skill`)
  })

  it.each([new Error('corrupt archive'), { type: 'READ_FAILED', reason: 'permission denied' }])(
    'uses the neutral localized fallback for an unknown error',
    (error) => {
      expect(getSkillImportErrorMessage(error, { kind: 'zip', name: 'broken.zip' }, t)).toBe(
        'settings.skills.installFailed:broken.zip'
      )
    }
  )
})
