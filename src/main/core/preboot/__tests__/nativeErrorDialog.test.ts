import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const { getLocale, isReady, openExternal, showMessageBox, whenReady, writeText } = vi.hoisted(() => ({
  getLocale: vi.fn(() => 'en-US'),
  isReady: vi.fn(() => true),
  openExternal: vi.fn(),
  showMessageBox: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  writeText: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getLocale, isReady, whenReady },
  clipboard: { writeText },
  dialog: { showMessageBox },
  shell: { openExternal }
}))

import { showSupportedMessageBox } from '../nativeErrorDialog'

const box = {
  type: 'error' as const,
  title: 'Database Unavailable',
  message: 'Cherry Studio could not access its local database.',
  detail: 'Retry after checking the disk.',
  buttons: ['Retry', 'Quit'],
  defaultId: 0,
  cancelId: 1
}

describe('showSupportedMessageBox', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
    writeText.mockReset()
    openExternal.mockReset().mockResolvedValue(undefined)
    isReady.mockReset().mockReturnValue(true)
    whenReady.mockReset().mockResolvedValue(undefined)
    getLocale.mockReset().mockReturnValue('en-US')
    vi.mocked(application.get).mockClear()
  })

  it('copies the technical detail, opens feedback, then returns the original retry index', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 0 })

    const response = await showSupportedMessageBox({
      box,
      technicalDetail: 'SQLITE_READONLY at /Users/private/cherrystudio.sqlite'
    })

    expect(response).toBe(0)
    expect(writeText).toHaveBeenCalledWith('SQLITE_READONLY at /Users/private/cherrystudio.sqlite')
    expect(openExternal).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/))
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(openExternal.mock.invocationCallOrder[0])
    expect(JSON.stringify(showMessageBox.mock.calls[0][0])).not.toContain('/Users/private')
    expect(showMessageBox.mock.calls[0][0].buttons).toEqual([
      'Retry',
      'Quit',
      'Copy error and send feedback…',
      'Open download page'
    ])
  })

  it('still opens feedback when the copy fails, and reports the failure on the same dialog', async () => {
    writeText.mockImplementationOnce(() => {
      throw new Error('clipboard unavailable')
    })
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({
      box,
      technicalDetail: 'SQLITE_READONLY at /Users/private/cherrystudio.sqlite'
    })

    expect(response).toBe(1)
    expect(openExternal).toHaveBeenCalledOnce()
    expect(showMessageBox.mock.calls[1][0].detail).toContain('That action failed.')
    expect(showMessageBox.mock.calls[1][0].detail).not.toContain('clipboard unavailable')
    expect(JSON.stringify(showMessageBox.mock.calls[1][0])).not.toContain('/Users/private')
  })

  it('keeps the copy and returns to the original dialog when feedback cannot be opened', async () => {
    openExternal.mockRejectedValueOnce(new Error('no handler'))
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({ box, technicalDetail: 'SQLITE_READONLY' })

    expect(response).toBe(1)
    expect(writeText).toHaveBeenCalledWith('SQLITE_READONLY')
    expect(showMessageBox.mock.calls[1][0].detail).toContain('That action failed.')
    expect(showMessageBox.mock.calls[1][0].detail).not.toContain('no handler')
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('places the caller action right after the primary buttons and stays within four buttons', async () => {
    const run = vi.fn(async () => undefined)
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 0 })

    const response = await showSupportedMessageBox({
      box,
      action: { label: 'Export diagnostics', run }
    })

    expect(response).toBe(0)
    expect(run).toHaveBeenCalledOnce()
    expect(showMessageBox.mock.calls[0][0].buttons).toEqual([
      'Retry',
      'Quit',
      'Export diagnostics',
      'Copy error and send feedback…'
    ])
    expect(showMessageBox.mock.calls[1][0].detail).not.toContain('That action failed')
  })

  it('keeps every primary index when three primary buttons leave room for one extra button', async () => {
    const run = vi.fn(async () => undefined)
    showMessageBox.mockResolvedValue({ response: 2 })

    const response = await showSupportedMessageBox({
      box: { ...box, buttons: ['Retry', 'Use Default', 'Quit'], cancelId: 2 },
      action: { label: 'Export diagnostics', run }
    })

    expect(response).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(showMessageBox.mock.calls[0][0].buttons).toEqual(['Retry', 'Use Default', 'Quit', 'Export diagnostics'])
  })

  it('keeps a failed caller action on the same dialog and still honors quit', async () => {
    const run = vi.fn(async () => {
      throw new Error('Could not write the diagnostic archive')
    })
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({
      box,
      action: { label: 'Export diagnostics', run }
    })

    expect(response).toBe(1)
    expect(run).toHaveBeenCalledOnce()
    expect(showMessageBox.mock.calls[1][0].detail).toContain('That action failed.')
    expect(showMessageBox.mock.calls[1][0].detail).not.toContain('Could not write the diagnostic archive')
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('uses the supplied app language for support chrome when the OS locale is en-US', async () => {
    getLocale.mockReturnValue('en-US')
    showMessageBox.mockResolvedValue({ response: 0 })

    await showSupportedMessageBox({
      language: 'zh-CN',
      box: {
        type: 'error',
        title: '错误',
        message: 'Cherry Studio 无法在主窗口中显示此错误。',
        buttons: ['关闭']
      }
    })

    expect(getLocale).not.toHaveBeenCalled()
    expect(application.get).not.toHaveBeenCalled()
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      title: '错误',
      message: 'Cherry Studio 无法在主窗口中显示此错误。',
      buttons: ['关闭', '复制错误并反馈…', '打开官网下载页']
    })
    expect(showMessageBox.mock.calls[0][0].detail).toBeUndefined()
  })

  it('waits until Electron is ready before showing the dialog', async () => {
    isReady.mockReturnValue(false)
    let markReady: () => void = () => undefined
    whenReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          markReady = () => {
            isReady.mockReturnValue(true)
            resolve()
          }
        })
    )
    showMessageBox.mockResolvedValue({ response: 1 })

    const pending = showSupportedMessageBox({ box, technicalDetail: 'SQLITE_READONLY at /Users/private/db' })
    await Promise.resolve()
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(getLocale).not.toHaveBeenCalled()

    markReady()
    await expect(pending).resolves.toBe(1)
    expect(showMessageBox.mock.calls[0][0].detail).toBe(box.detail)
    expect(JSON.stringify(showMessageBox.mock.calls[0][0])).not.toContain('/Users/private')
  })

  it('uses the catalog OK button when the caller does not supply one', async () => {
    showMessageBox.mockResolvedValue({ response: 0 })

    await expect(
      showSupportedMessageBox({ box: { type: 'error', title: 'Restore failed', message: 'Previous data was kept.' } })
    ).resolves.toBe(0)
    expect(showMessageBox.mock.calls[0][0].buttons[0]).toBe('OK')
    expect(showMessageBox.mock.calls[0][0].buttons[0]).not.toBe('dialog.support.ok')
  })

  it('returns the original cancel button when the response is outside the dialog', async () => {
    showMessageBox.mockResolvedValue({ response: 99 })

    await expect(showSupportedMessageBox({ box })).resolves.toBe(1)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      locale: 'en-US',
      ok: 'OK',
      support: 'Copy error and send feedback…',
      releases: 'Open download page'
    },
    {
      locale: 'zh-CN',
      ok: '确定',
      support: '复制错误并反馈…',
      releases: '打开官网下载页'
    }
  ])(
    'reads $locale only after Electron is ready and shows that catalog without PreferenceService',
    async ({ locale, ok, support, releases }) => {
      isReady.mockReturnValue(false)
      getLocale.mockImplementation(() => {
        expect(isReady()).toBe(true)
        return locale
      })
      let markReady: () => void = () => undefined
      whenReady.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            markReady = () => {
              isReady.mockReturnValue(true)
              resolve()
            }
          })
      )
      showMessageBox.mockResolvedValue({ response: 0 })

      const pending = showSupportedMessageBox({
        box: { type: 'error', title: 'Database Unavailable', message: 'The caller supplied this sentence.' }
      })
      await Promise.resolve()
      expect(getLocale).not.toHaveBeenCalled()
      expect(showMessageBox).not.toHaveBeenCalled()
      expect(application.get).not.toHaveBeenCalled()

      markReady()
      await expect(pending).resolves.toBe(0)

      expect(getLocale).toHaveBeenCalledTimes(1)
      expect(application.get).not.toHaveBeenCalled()
      expect(showMessageBox).toHaveBeenCalledTimes(1)
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({
        title: 'Database Unavailable',
        message: 'The caller supplied this sentence.',
        buttons: [ok, support, releases]
      })
      expect(JSON.stringify(showMessageBox.mock.calls[0][0])).not.toContain('[to be translated]')
      expect(showMessageBox.mock.calls[0][0].buttons[0]).not.toBe('dialog.support.ok')
    }
  )
})
