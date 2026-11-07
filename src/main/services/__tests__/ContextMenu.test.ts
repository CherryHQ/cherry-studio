import { beforeEach, describe, expect, it, vi } from 'vitest'

const { menuMock, browserWindowMock, popupMock, windowMock } = vi.hoisted(() => {
  const popupMock = vi.fn()
  return {
    popupMock,
    windowMock: { id: 1 },
    menuMock: {
      buildFromTemplate: vi.fn(() => ({ popup: popupMock }))
    },
    browserWindowMock: {
      fromWebContents: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  Menu: menuMock
}))

vi.mock('@main/i18n', () => ({
  getI18n: () => ({
    translation: { common: { copy: 'Copy', paste: 'Paste', cut: 'Cut', inspect: 'Inspect' } }
  })
}))

import { contextMenu } from '../ContextMenu'

const createProperties = () =>
  ({
    selectionText: 'hello',
    isEditable: false,
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: { canCopy: true, canPaste: false, canCut: false }
  }) as unknown as Electron.ContextMenuParams

/** Registers the menu on a fake webContents and fires a `context-menu` event on it. */
const popupFor = (properties = createProperties(), hostWebContents: unknown = null) => {
  let handler: ((event: unknown, properties: Electron.ContextMenuParams) => void) | undefined
  const webContents = {
    hostWebContents,
    on: vi.fn((channel: string, listener: typeof handler) => {
      if (channel === 'context-menu') handler = listener
    })
  } as unknown as Electron.WebContents

  contextMenu.contextMenu(webContents)
  handler?.({}, properties)
  return webContents
}

describe('ContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pops the menu on the window owning the webContents', () => {
    browserWindowMock.fromWebContents.mockReturnValue(windowMock)

    const webContents = popupFor()

    expect(browserWindowMock.fromWebContents).toHaveBeenCalledWith(webContents)
    expect(popupMock).toHaveBeenCalledWith({ window: windowMock })
  })

  it('falls back to the host window for a webview guest', () => {
    const host = { isDestroyed: () => false }
    browserWindowMock.fromWebContents.mockImplementation((contents: unknown) => (contents === host ? windowMock : null))

    popupFor(createProperties(), host)

    expect(popupMock).toHaveBeenCalledWith({ window: windowMock })
  })

  it('does not reach into a destroyed host, whose members throw', () => {
    const host = { isDestroyed: () => true }
    browserWindowMock.fromWebContents.mockReturnValue(null)

    popupFor(createProperties(), host)

    expect(browserWindowMock.fromWebContents).toHaveBeenCalledTimes(1)
    expect(popupMock).toHaveBeenCalledWith({ window: undefined })
  })

  it('still pops the menu when neither the webContents nor a host resolves a window', () => {
    browserWindowMock.fromWebContents.mockReturnValue(null)

    expect(() => popupFor()).not.toThrow()
    expect(popupMock).toHaveBeenCalledWith({ window: undefined })
  })

  it('does not pop an empty menu', () => {
    browserWindowMock.fromWebContents.mockReturnValue(windowMock)

    popupFor({
      selectionText: '',
      isEditable: false,
      misspelledWord: '',
      dictionarySuggestions: [],
      editFlags: { canCopy: false, canPaste: false, canCut: false }
    } as unknown as Electron.ContextMenuParams)

    expect(popupMock).not.toHaveBeenCalled()
  })
})
