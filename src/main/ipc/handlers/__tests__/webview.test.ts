import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, setOpenLinkExternalMock, fromIdMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  setOpenLinkExternalMock: vi.fn(),
  fromIdMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/WebviewService', () => ({ setOpenLinkExternal: setOpenLinkExternalMock }))
vi.mock('electron', () => ({ webContents: { fromId: fromIdMock } }))

import { webviewHandlers } from '../webview'

const replaceAnnotations = vi.fn()
const webviewService = {
  getAnnotationsMarkdown: vi.fn(),
  printWebviewToPDF: vi.fn(),
  replaceAnnotations,
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

  it('get_annotations_markdown validates through WebviewService and returns the resolved export', async () => {
    webviewService.getAnnotationsMarkdown.mockResolvedValue('# Annotations')

    expect(await webviewHandlers['webview.get_annotations_markdown']({ webviewId: 7 }, ctx)).toBe('# Annotations')
    expect(webviewService.getAnnotationsMarkdown).toHaveBeenCalledWith(7, 'w1')
  })

  it('replace_annotations forwards the complete snapshot and caller identity', async () => {
    const input = {
      webviewId: 7,
      target: { id: 'mini-app:demo', label: 'Demo' },
      annotations: []
    }

    await webviewHandlers['webview.replace_annotations'](input, ctx)

    expect(replaceAnnotations).toHaveBeenCalledWith(input, 'w1')
  })

  it('save_as_html delegates and returns null on cancel', async () => {
    webviewService.saveWebviewAsHTML.mockResolvedValue(null)
    expect(await webviewHandlers['webview.save_as_html']({ webviewId: 7 }, ctx)).toBeNull()
    expect(webviewService.saveWebviewAsHTML).toHaveBeenCalledWith(7)
  })
})
