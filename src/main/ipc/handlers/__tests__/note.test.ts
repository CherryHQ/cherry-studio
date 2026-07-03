import { noteRequestSchemas } from '@shared/ipc/schemas/note'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportToPDF, print } = vi.hoisted(() => ({
  exportToPDF: vi.fn(),
  print: vi.fn()
}))

vi.mock('@main/services/NotePrintService', () => ({
  notePrintService: {
    exportToPDF,
    print
  }
}))

import { noteHandlers } from '../note'

const payload = {
  title: 'Meeting Notes',
  markdown: '# Heading',
  sourcePath: '/Users/me/Notes/meeting.md'
}

describe('noteHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes boolean output for PDF export', () => {
    const output = noteRequestSchemas['note.export_pdf'].output

    expect(output.safeParse(true).success).toBe(true)
    expect(output.safeParse(false).success).toBe(true)
    expect(output.safeParse('/tmp/Meeting Notes.pdf').success).toBe(false)
    expect(output.safeParse(null).success).toBe(false)
  })

  it('exports the printed note to PDF through NotePrintService', async () => {
    exportToPDF.mockResolvedValue(true)

    const result = await noteHandlers['note.export_pdf'](payload, { senderId: 'main-1' })

    expect(result).toBe(true)
    expect(exportToPDF).toHaveBeenCalledWith(payload)
  })

  it('prints the current note through NotePrintService', async () => {
    await noteHandlers['note.print'](payload, { senderId: 'main-1' })

    expect(print).toHaveBeenCalledWith(payload)
  })
})
