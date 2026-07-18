// Unit tests for resolvePreset — pure domain-set mapping (no DB).
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import { describe, expect, it } from 'vitest'

import {
  type BackupPreset,
  LITE_EXCLUDED,
  presetIncludesFiles,
  presetIncludesKnowledge,
  resolvePreset
} from '../presets'

const ALL = new Set<BackupDomain>(BACKUP_DOMAINS)
const LITE_EXCLUDED_SET = new Set<BackupDomain>(LITE_EXCLUDED)

describe('resolvePreset', () => {
  it('full = all 14 domains', () => {
    // Arrange / Act
    const r = resolvePreset('full')
    // Assert — exact count + membership equals the canonical 14
    expect(r).toHaveLength(14)
    expect(new Set(r)).toEqual(ALL)
  })

  it('lite = 10 domains (excludes KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY)', () => {
    const r = resolvePreset('lite')
    expect(r).toHaveLength(10)
    expect(new Set(r)).toEqual(new Set([...ALL].filter((d) => !LITE_EXCLUDED_SET.has(d))))
  })

  it('lite is a subset of full', () => {
    const full = new Set(resolvePreset('full'))
    for (const d of resolvePreset('lite')) {
      expect(full.has(d)).toBe(true)
    }
  })

  it('lite excludes exactly the 4 large-blob / history domains', () => {
    const lite = new Set(resolvePreset('lite'))
    for (const d of LITE_EXCLUDED_SET) {
      expect(lite.has(d)).toBe(false)
    }
  })

  it('rejects an invalid preset (fail-closed — no silent fallthrough to lite)', () => {
    // The static type is 'full' | 'lite', but IPC input is unvalidated at runtime
    // (TODO(ipc-boundary) in BackupService). A typo MUST throw rather than resolve
    // 10 domains + skip the step-2.5 strip (which would leak excluded-domain rows
    // into a lite-labelled archive).
    expect(() => resolvePreset('liten' as BackupPreset)).toThrow(/invalid preset/)
  })

  it('returns independent copies (mutating the result does not affect BACKUP_DOMAINS)', () => {
    const before = [...BACKUP_DOMAINS]
    const r = resolvePreset('full') as BackupDomain[]
    r.push('KNOWLEDGE')
    // BACKUP_DOMAINS must be unchanged — export must not mutate the shared tuple
    expect([...BACKUP_DOMAINS]).toEqual(before)
  })
})

describe('presetIncludesFiles / presetIncludesKnowledge', () => {
  it('full includes both files and knowledge', () => {
    expect(presetIncludesFiles('full')).toBe(true)
    expect(presetIncludesKnowledge('full')).toBe(true)
  })

  it('lite includes neither files nor knowledge', () => {
    expect(presetIncludesFiles('lite')).toBe(false)
    expect(presetIncludesKnowledge('lite')).toBe(false)
  })
})
