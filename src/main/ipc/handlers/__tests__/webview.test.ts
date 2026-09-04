import { webviewRequestSchemas } from '@shared/ipc/schemas/webview'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, setOpenLinkExternalMock, fromIdMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  setOpenLinkExternalMock: vi.fn(),
  fromIdMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/webview', () => ({ setOpenLinkExternal: setOpenLinkExternalMock }))
vi.mock('electron', () => ({ webContents: { fromId: fromIdMock } }))

import { webviewHandlers } from '../webview'

const exportAnnotations = vi.fn()
const webviewService = {
  exportAnnotations,
  printWebviewToPDF: vi.fn(),
  saveWebviewAsHTML: vi.fn()
}
const setSpellCheckerEnabled = vi.fn()
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WebviewService') return webviewService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('webviewHandlers', () => {
  it('set_open_link_external delegates to the WebviewService module fn', async () => {
    await webviewHandlers['webview.set_open_link_external']({ webviewId: 7, isExternal: true }, ctx)
    expect(setOpenLinkExternalMock).toHaveBeenCalledWith(7, true)
  })

  it('set_spell_check_enabled toggles the guest session spellchecker', async () => {
    fromIdMock.mockReturnValue({ session: { setSpellCheckerEnabled } })
    await webviewHandlers['webview.set_spell_check_enabled']({ webviewId: 7, isEnable: false }, ctx)
    expect(fromIdMock).toHaveBeenCalledWith(7)
    expect(setSpellCheckerEnabled).toHaveBeenCalledWith(false)
  })

  it('set_spell_check_enabled is a no-op when the guest is gone', async () => {
    fromIdMock.mockReturnValue(undefined)
    await expect(
      webviewHandlers['webview.set_spell_check_enabled']({ webviewId: 7, isEnable: true }, ctx)
    ).resolves.toBeUndefined()
  })

  it('print_to_pdf delegates and returns the written path (or null)', async () => {
    webviewService.printWebviewToPDF.mockResolvedValue('/tmp/out.pdf')
    expect(await webviewHandlers['webview.print_to_pdf']({ webviewId: 7 }, ctx)).toBe('/tmp/out.pdf')
    expect(webviewService.printWebviewToPDF).toHaveBeenCalledWith(7)
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
    expect(webviewService.saveWebviewAsHTML).toHaveBeenCalledWith(7)
  })
})
