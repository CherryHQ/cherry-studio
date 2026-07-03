import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildPrintedNoteHtml, NotePrintService } from '../NotePrintService'

const { writeFile } = vi.hoisted(() => ({
  writeFile: vi.fn()
}))

vi.mock('@main/utils/language', () => ({
  t: (key: string) => key
}))

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile
  }
}))

const windowId = 'note-print-window-1'
const loadURL = vi.fn()
const printToPDF = vi.fn()
const print = vi.fn()
const executeJavaScript = vi.fn()
const showInactive = vi.fn()
const close = vi.fn()
const open = vi.fn()
const getWindow = vi.fn()

const windowManager = {
  open,
  close,
  getWindow
}

const payload = {
  title: 'Meeting Notes',
  markdown: '# Heading\n\nBody text',
  sourcePath: '/Users/me/Notes/meeting.md'
}

describe('NotePrintService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'WindowManager') return windowManager as never
      throw new Error(`Unexpected application.get(${name})`)
    })
    open.mockReturnValue(windowId)
    getWindow.mockReturnValue({
      loadURL,
      showInactive,
      webContents: {
        printToPDF,
        print,
        executeJavaScript
      }
    })
    loadURL.mockResolvedValue(undefined)
    printToPDF.mockResolvedValue(Buffer.from('pdf-data'))
    print.mockImplementation((_options, callback) => callback(true))
    executeJavaScript.mockResolvedValue(undefined)
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Meeting Notes.pdf'
    } as never)
    writeFile.mockResolvedValue(undefined)
  })

  it('builds paper-oriented HTML from rendered Markdown and a file base URL', () => {
    const html = buildPrintedNoteHtml({
      title: '<Unsafe>',
      markdown: '# Safe\n\n<script>alert(1)</script>',
      sourcePath: '/Users/me/Notes/safe.md'
    })

    expect(html).toContain('<base href="file:///Users/me/Notes/" />')
    expect(html).toContain('&lt;Unsafe&gt;')
    expect(html).toContain('<h1>Safe</h1>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('@page')
  })

  it('reports success after exporting the printed note to PDF through a WindowManager-owned print window', async () => {
    const service = new NotePrintService()

    const result = await service.exportToPDF(payload)

    expect(result).toBe(true)
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'dialog.save_as_pdf',
        defaultPath: 'Meeting Notes.pdf',
        filters: [{ name: 'dialog.pdf_files', extensions: ['pdf'] }]
      })
    )
    expect(open).toHaveBeenCalledWith(WindowType.NotePrint)
    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/))
    expect(printToPDF).toHaveBeenCalledWith({
      margins: { marginType: 'default' },
      pageSize: 'A4',
      preferCSSPageSize: true,
      printBackground: true
    })
    expect(writeFile).toHaveBeenCalledWith('/tmp/Meeting Notes.pdf', Buffer.from('pdf-data'))
    expect(close).toHaveBeenCalledWith(windowId)
  })

  it('does not create a print window when PDF export is canceled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined } as never)
    const service = new NotePrintService()

    const result = await service.exportToPDF(payload)

    expect(result).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('closes the WindowManager entry when the print window cannot be resolved', async () => {
    getWindow.mockReturnValue(undefined)
    const service = new NotePrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('Note print window not found')

    expect(open).toHaveBeenCalledWith(WindowType.NotePrint)
    expect(close).toHaveBeenCalledWith(windowId)
    expect(loadURL).not.toHaveBeenCalled()
    expect(printToPDF).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('closes the print window when loading the generated print page fails', async () => {
    loadURL.mockRejectedValue(new Error('load failed'))
    const service = new NotePrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('load failed')

    expect(close).toHaveBeenCalledWith(windowId)
    expect(printToPDF).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('closes the print window when PDF generation fails', async () => {
    printToPDF.mockRejectedValue(new Error('pdf failed'))
    const service = new NotePrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('pdf failed')

    expect(close).toHaveBeenCalledWith(windowId)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('prints from the renderer page without flashing the print host window', async () => {
    let finishPrint!: () => void
    executeJavaScript.mockReturnValue(new Promise<void>((resolve) => (finishPrint = resolve)))
    const service = new NotePrintService()

    const printPromise = service.print(payload)
    await Promise.resolve()
    await Promise.resolve()

    expect(open).toHaveBeenCalledWith(WindowType.NotePrint)
    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/))
    expect(showInactive).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('window.print()'), true)
    expect(close).not.toHaveBeenCalled()

    finishPrint()
    await printPromise

    expect(close).toHaveBeenCalledWith(windowId)
  })

  it('treats closing the print dialog as a canceled print instead of a failure', async () => {
    const service = new NotePrintService()

    await expect(service.print(payload)).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledWith(windowId)
  })

  it('rejects when renderer print execution fails', async () => {
    executeJavaScript.mockRejectedValue(new Error('print execution failed'))
    const service = new NotePrintService()

    await expect(service.print(payload)).rejects.toThrow('print execution failed')
    expect(close).toHaveBeenCalledWith(windowId)
  })
})
