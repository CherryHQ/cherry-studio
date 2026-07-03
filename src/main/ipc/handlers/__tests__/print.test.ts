import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportToPDF, print } = vi.hoisted(() => ({
  exportToPDF: vi.fn(),
  print: vi.fn()
}))

vi.mock('@main/services/PrintService', () => ({
  printService: {
    exportToPDF,
    print
  }
}))

import { printHandlers } from '../print'

const payload = {
  title: 'Meeting Notes',
  source: {
    type: 'markdown' as const,
    markdown: '# Heading'
  },
  sourcePath: '/Users/me/Notes/meeting.md'
}

describe('printHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports a printable document to PDF through PrintService', async () => {
    exportToPDF.mockResolvedValue(true)

    const result = await printHandlers['print.export_pdf'](payload, { senderId: 'main-1' })

    expect(result).toBe(true)
    expect(exportToPDF).toHaveBeenCalledWith(payload)
  })

  it('prints a printable document through PrintService', async () => {
    await printHandlers['print.print'](payload, { senderId: 'main-1' })

    expect(print).toHaveBeenCalledWith(payload)
  })
})
