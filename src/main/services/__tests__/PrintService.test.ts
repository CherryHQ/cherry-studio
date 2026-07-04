import { application } from '@application'
import { WindowType } from '@main/core/window/types'
import { dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildPrintableHtml, PrintService } from '../PrintService'

const { writeFile } = vi.hoisted(() => ({
  writeFile: vi.fn()
}))

vi.mock('@main/i18n', () => ({
  t: (key: string) => key
}))

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile
  }
}))

const windowId = 'print-window-1'
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
  source: {
    markdown: '# Heading\n\nBody text'
  },
  sourcePath: '/Users/me/Notes/meeting.md'
}

describe('PrintService', () => {
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
    const html = buildPrintableHtml({
      title: '<Unsafe>',
      source: {
        markdown: '# Safe\n\n<script>alert(1)</script>'
      },
      sourcePath: '/Users/me/Notes/safe.md'
    })

    expect(html).toContain('<base href="file:///Users/me/Notes/" />')
    expect(html).toContain('&lt;Unsafe&gt;')
    expect(html).toContain('<h1>Safe</h1>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('@page')
  })

  it('includes CJK-capable font fallbacks for printable documents', () => {
    const html = buildPrintableHtml({
      title: '会议记录',
      source: {
        markdown: '# 标题\n\n中文正文'
      }
    })

    expect(html).toContain('<html>')
    expect(html).not.toContain('lang="zh-CN"')
    expect(html).toContain('@font-face')
    expect(html).toContain('local("PingFang SC")')
    expect(html).toContain('local("SimSun")')
    expect(html).toContain('local("Arial Unicode MS")')
    expect(html).toContain('<h1 class="printable-title">会议记录</h1>')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>中文正文</p>')
    expect(html).toContain('"PingFang SC"')
    expect(html).toContain('"Microsoft YaHei"')
    expect(html).toContain('"Noto Sans CJK SC"')
  })

  it('reports success after exporting a printable document to PDF through a WindowManager-owned print window', async () => {
    const service = new PrintService()

    const result = await service.exportToPDF(payload)

    expect(result).toBe(true)
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'dialog.save_as_pdf',
        defaultPath: 'Meeting Notes.pdf',
        filters: [{ name: 'dialog.pdf_files', extensions: ['pdf'] }]
      })
    )
    expect(open).toHaveBeenCalledWith(WindowType.Print)
    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/))
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('document.fonts.ready'), true)
    expect(executeJavaScript.mock.invocationCallOrder[0]).toBeLessThan(printToPDF.mock.invocationCallOrder[0])
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
    const service = new PrintService()

    const result = await service.exportToPDF(payload)

    expect(result).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('closes the WindowManager entry when the print window cannot be resolved', async () => {
    getWindow.mockReturnValue(undefined)
    const service = new PrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('Print window not found')

    expect(open).toHaveBeenCalledWith(WindowType.Print)
    expect(close).toHaveBeenCalledWith(windowId)
    expect(loadURL).not.toHaveBeenCalled()
    expect(printToPDF).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('closes the print window when loading the generated print page fails', async () => {
    loadURL.mockRejectedValue(new Error('load failed'))
    const service = new PrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('load failed')

    expect(close).toHaveBeenCalledWith(windowId)
    expect(printToPDF).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('closes the print window when PDF generation fails', async () => {
    printToPDF.mockRejectedValue(new Error('pdf failed'))
    const service = new PrintService()

    await expect(service.exportToPDF(payload)).rejects.toThrow('pdf failed')

    expect(close).toHaveBeenCalledWith(windowId)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('prints through the main process without passing native print options', async () => {
    let finishPrint!: (success: boolean, failureReason: string) => void
    print.mockImplementation((_options, callback) => {
      finishPrint = callback
    })
    const service = new PrintService()

    const printPromise = service.print(payload)
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve()
    }

    expect(open).toHaveBeenCalledWith(WindowType.Print)
    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/))
    expect(showInactive).not.toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('document.fonts.ready'), true)
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledWith({}, expect.any(Function))
    expect(close).not.toHaveBeenCalled()

    finishPrint(true, '')
    await printPromise

    expect(close).toHaveBeenCalledWith(windowId)
  })

  it('treats closing the print dialog as a canceled print instead of a failure', async () => {
    print.mockImplementation((_options, callback) => callback(false, 'Print job canceled'))
    const service = new PrintService()

    await expect(service.print(payload)).resolves.toBeUndefined()
    expect(print).toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith(windowId)
  })

  it('rejects when native print fails for reasons other than user cancellation', async () => {
    print.mockImplementation((_options, callback) => callback(false, 'Print job failed'))
    const service = new PrintService()

    await expect(service.print(payload)).rejects.toThrow('Print job failed')
    expect(close).toHaveBeenCalledWith(windowId)
  })
})
