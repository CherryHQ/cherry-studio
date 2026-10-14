import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ReduxStateReader } from '../ReduxStateReader'

describe('ReduxStateReader file source', () => {
  let exportPath: string

  beforeEach(() => {
    exportPath = fs.mkdtempSync(path.join(os.tmpdir(), 'redux-state-reader-'))
  })

  afterEach(() => {
    fs.rmSync(exportPath, { recursive: true, force: true })
  })

  it('loads one exported category on demand', () => {
    fs.writeFileSync(path.join(exportPath, 'settings.json'), JSON.stringify({ theme: { mode: 'dark' } }))
    fs.writeFileSync(path.join(exportPath, 'assistants.json'), JSON.stringify({ defaultAssistant: 'a1' }))
    const reader = new ReduxStateReader(exportPath)

    expect(reader.get('settings', 'theme.mode')).toBe('dark')
    expect(reader.get('assistants', 'defaultAssistant')).toBe('a1')
  })

  it('reuses one parsed category until another category is requested', () => {
    fs.writeFileSync(path.join(exportPath, 'settings.json'), JSON.stringify({ theme: { mode: 'dark' } }))
    fs.writeFileSync(path.join(exportPath, 'assistants.json'), JSON.stringify({ defaultAssistant: 'a1' }))
    const reader = new ReduxStateReader(exportPath)

    expect(reader.get('settings', 'theme.mode')).toBe('dark')
    fs.writeFileSync(path.join(exportPath, 'settings.json'), JSON.stringify({ theme: { mode: 'light' } }))
    expect(reader.get('settings', 'theme.mode')).toBe('dark')

    expect(reader.get('assistants', 'defaultAssistant')).toBe('a1')
    expect(reader.get('settings', 'theme.mode')).toBe('light')
  })

  it('preserves the legacy raw-string fallback for a malformed slice', () => {
    fs.writeFileSync(path.join(exportPath, 'settings.json'), 'not-json')

    expect(new ReduxStateReader(exportPath).getCategory('settings')).toBe('not-json')
  })

  it('returns undefined for a missing category', () => {
    const reader = new ReduxStateReader(exportPath)

    expect(reader.getCategory('missing')).toBeUndefined()
    fs.writeFileSync(path.join(exportPath, 'missing.json'), JSON.stringify({ now: 'present' }))
    expect(reader.getCategory('missing')).toBeUndefined()
    expect(reader.getCategory('another-missing')).toBeUndefined()
    expect(reader.getCategory('missing')).toEqual({ now: 'present' })
  })
})
