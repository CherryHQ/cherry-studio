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
    expect(reader.hasCategory('assistants')).toBe(true)
    expect(reader.getCategories().sort()).toEqual(['assistants', 'settings'])
  })

  it('preserves the legacy raw-string fallback for a malformed slice', () => {
    fs.writeFileSync(path.join(exportPath, 'settings.json'), 'not-json')

    expect(new ReduxStateReader(exportPath).getCategory('settings')).toBe('not-json')
  })

  it('returns undefined for a missing category', () => {
    expect(new ReduxStateReader(exportPath).getCategory('missing')).toBeUndefined()
  })
})
