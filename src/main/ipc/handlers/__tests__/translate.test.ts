import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, openMock } = vi.hoisted(() => ({ appGetMock: vi.fn(), openMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@main/services/translate/translateService', () => ({ translateService: { open: openMock } }))

import { translateHandlers } from '../translate'

const webContents = {}
const windowManager = { getWindow: vi.fn(() => ({ webContents })) }
const req = { streamId: 'translate:1', text: 'hi', targetLangCode: 'en' } as Parameters<
  (typeof translateHandlers)['translate.open']
>[0]

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('translateHandlers', () => {
  it('open resolves the caller WebContents and delegates to translateService', async () => {
    openMock.mockReturnValue({ streamId: 'translate:1' })
    expect(await translateHandlers['translate.open'](req, { senderId: 'w1' })).toEqual({ streamId: 'translate:1' })
    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(openMock).toHaveBeenCalledWith(webContents, req)
  })

  it('open throws when the caller is not a WindowManager-tracked window', async () => {
    await expect(translateHandlers['translate.open'](req, { senderId: null })).rejects.toThrow(
      'translate.open requires a managed window'
    )
  })
})
