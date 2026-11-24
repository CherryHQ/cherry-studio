import { describe, expect, it } from 'vitest'

import { getFileIconName } from '@renderer/utils/fileIconName'

import { getFileIconPath } from '../fileDisplay'

describe('getFileIconPath', () => {
  it('keeps names that already carry their extension', () => {
    expect(getFileIconPath({ name: 'report.docx', format: 'docx' })).toBe('report.docx')
  })

  it('appends a missing extension so the shared icon map can resolve it', () => {
    expect(getFileIconPath({ name: 'report', format: 'docx' })).toBe('report.docx')
  })

  it('returns the bare name when no format is known', () => {
    expect(getFileIconPath({ name: 'mystery', format: '' })).toBe('mystery')
  })
})

describe('Files library shares the composer/message icon mapping', () => {
  const iconFor = (name: string, format: string) => getFileIconName(getFileIconPath({ name, format }))

  it('maps supported office families to matching category icons', () => {
    expect(iconFor('report.docx', 'docx')).toBe('word')
    expect(iconFor('report.odt', 'odt')).toBe('word')
    expect(iconFor('notes.rtf', 'rtf')).toBe('word')
    expect(iconFor('budget.xlsx', 'xlsx')).toBe('table')
    expect(iconFor('budget.ods', 'ods')).toBe('table')
    expect(iconFor('deck.pptx', 'pptx')).toBe('powerpoint')
    expect(iconFor('deck.odp', 'odp')).toBe('powerpoint')
    expect(iconFor('book.epub', 'epub')).toBe('epub')
  })

  it('falls back to a generic document icon instead of suggesting TXT', () => {
    expect(iconFor('archive.zip', 'zip')).toBe('zip')
    expect(iconFor('mystery.xyz', 'xyz')).toBe('document')
    expect(iconFor('mystery', '')).toBe('document')
  })
})
