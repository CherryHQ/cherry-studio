import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as XLSX from '@e965/xlsx'
import { afterAll, describe, expect, it, vi } from 'vitest'

// `t` pulls in i18n + preference machinery that isn't initialized under test.
vi.mock('@main/utils/language', () => ({ t: (key: string) => key }))

import { fileStorage } from '../FileStorage'

const event = {} as Electron.IpcMainInvokeEvent

// Regression coverage for #16270: legacy .xls and macro-enabled .xlsm workbooks
// are not supported by officeparser, so they must be read via SheetJS instead.
describe('FileStorage.readExternalFile - spreadsheet formats (#16270)', () => {
  const created: string[] = []

  const writeWorkbook = (ext: string): string => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Alice', 91],
      ['Bob', 88]
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const file = path.join(os.tmpdir(), `cs-xls-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
    // Write via an in-memory buffer (the ESM build does not bind Node fs for writeFile).
    const bookType = ext.replace('.', '') as 'xls' | 'xlsm'
    const buffer = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
    fs.writeFileSync(file, buffer)
    created.push(file)
    return file
  }

  afterAll(() => {
    for (const file of created) {
      try {
        fs.rmSync(file, { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  it('reads a legacy .xls workbook via SheetJS', async () => {
    const content = await fileStorage.readExternalFile(event, writeWorkbook('.xls'))
    expect(content).toContain('Alice')
    expect(content).toContain('91')
  })

  it('reads a macro-enabled .xlsm workbook via SheetJS', async () => {
    const content = await fileStorage.readExternalFile(event, writeWorkbook('.xlsm'))
    expect(content).toContain('Bob')
    expect(content).toContain('88')
  })
})
