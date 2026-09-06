import { webviewRequestSchemas } from '@shared/ipc/schemas/webview'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
import { webviewHandlers } from '../webview'

const exportAnnotations = vi.fn()
const webviewService = {
  exportAnnotations,
  printWebviewToPDF: vi.fn(),
  saveWebviewAsHTML: vi.fn(),
  setOpenLinkExternal: vi.fn(),
  setSpellCheckerEnabled: vi.fn()
}
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WebviewService') return webviewService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('webviewHandlers', () => {
  it('set_open_link_external forwards the caller identity for ownership validation', async () => {
    await webviewHandlers['webview.set_open_link_external']({ webviewId: 7, isExternal: true }, ctx)
    expect(webviewService.setOpenLinkExternal).toHaveBeenCalledWith(7, true, 'w1')
  })

  it('set_spell_check_enabled forwards the caller identity for ownership validation', async () => {
    await webviewHandlers['webview.set_spell_check_enabled']({ webviewId: 7, isEnable: false }, ctx)
    expect(webviewService.setSpellCheckerEnabled).toHaveBeenCalledWith(7, false, 'w1')
  })

  it('print_to_pdf delegates and returns the written path (or null)', async () => {
    webviewService.printWebviewToPDF.mockResolvedValue('/tmp/out.pdf')
    expect(await webviewHandlers['webview.print_to_pdf']({ webviewId: 7 }, ctx)).toBe('/tmp/out.pdf')
    expect(webviewService.printWebviewToPDF).toHaveBeenCalledWith(7, 'w1')
  })

  it('export_annotations forwards the complete request and caller identity', async () => {
    const input = {
      webviewId: 7,
      documentSessionId: '00000000-0000-4000-8000-000000000001',
      target: { id: 'mini-app:demo', label: 'Demo' },
      annotations: [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          comment: 'Fix this',
          element: { selector: '#target', tagName: 'button', text: null, ariaLabel: null, role: 'button' }
        }
      ]
    }

    exportAnnotations.mockResolvedValue('# Annotations')
    const parsedInput = webviewRequestSchemas['webview.export_annotations'].input.parse(input)
    expect(await webviewHandlers['webview.export_annotations'](parsedInput, ctx)).toBe('# Annotations')

    expect(exportAnnotations).toHaveBeenCalledWith(input, 'w1')
  })

  it('save_as_html delegates and returns null on cancel', async () => {
    webviewService.saveWebviewAsHTML.mockResolvedValue(null)
    expect(await webviewHandlers['webview.save_as_html']({ webviewId: 7 }, ctx)).toBeNull()
    expect(webviewService.saveWebviewAsHTML).toHaveBeenCalledWith(7, 'w1')
  })
})
