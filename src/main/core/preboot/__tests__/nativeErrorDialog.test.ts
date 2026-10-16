import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const { getLocale, isReady, openExternal, saveBundle, showMessageBox, showSaveDialog, whenReady, writeText } =
  vi.hoisted(() => ({
    getLocale: vi.fn(() => 'en-US'),
    isReady: vi.fn(() => true),
    openExternal: vi.fn(),
    saveBundle: vi.fn(),
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    writeText: vi.fn()
  }))

vi.mock('electron', () => ({
  app: { getLocale, isReady, whenReady },
  clipboard: { writeText },
  dialog: { showMessageBox, showSaveDialog },
  shell: { openExternal }
}))

vi.mock('@data/migration/v2', () => ({
  saveMigrationDiagnosticBundle: (...args: unknown[]) => saveBundle(...args)
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
    showSaveDialog.mockReset()
    writeText.mockReset()
    openExternal.mockReset().mockResolvedValue(undefined)
    saveBundle.mockReset().mockResolvedValue(true)
    isReady.mockReset().mockReturnValue(true)
    whenReady.mockReset().mockResolvedValue(undefined)
    getLocale.mockReset().mockReturnValue('en-US')
    vi.mocked(application.get).mockClear()
  })

  it('copies the technical detail, then returns the original retry index', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 0 })

    const response = await showSupportedMessageBox({
      box,
      technicalDetail: 'SQLITE_READONLY at /Users/private/cherrystudio.sqlite'
    })

    expect(response).toBe(0)
    expect(writeText).toHaveBeenCalledWith('SQLITE_READONLY at /Users/private/cherrystudio.sqlite')
    expect(JSON.stringify(showMessageBox.mock.calls[0][0])).not.toContain('/Users/private')
    expect(showMessageBox.mock.calls[0][0].buttons.slice(0, 2)).toEqual(['Retry', 'Quit'])
  })

  it('keeps a failed copy on the same dialog', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({
      box,
      technicalDetail: 'SQLITE_READONLY at /Users/private/cherrystudio.sqlite'
    })

    expect(response).toBe(1)
    expect(showMessageBox.mock.calls[1][0].detail).toContain('clipboard unavailable')
    expect(JSON.stringify(showMessageBox.mock.calls[1][0])).not.toContain('/Users/private')
  })

  it('returns to the original dialog when feedback cannot be opened', async () => {
    openExternal.mockRejectedValueOnce(new Error('no handler'))
    showMessageBox.mockResolvedValueOnce({ response: 3 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({ box })

    expect(response).toBe(1)
    expect(showMessageBox.mock.calls[1][0].detail).toContain('no handler')
    expect(showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed migration export on the same dialog and still honors quit', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/diagnostics.zip' })
    saveBundle.mockResolvedValue(false)
    showMessageBox.mockResolvedValueOnce({ response: 5 }).mockResolvedValueOnce({ response: 1 })

    const response = await showSupportedMessageBox({
      box,
      migrationExport: { stage: 'error', logDate: '2026-10-14' }
    })

    expect(response).toBe(1)
    expect(saveBundle).toHaveBeenCalledWith({
      destination: '/tmp/diagnostics.zip',
      stage: 'error',
      logDate: '2026-10-14'
    })
    expect(showMessageBox.mock.calls[1][0].detail).toContain('Could not write the diagnostic archive')
  })

  it('waits until Electron is ready and says analysis is unavailable', async () => {
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
    expect(showMessageBox.mock.calls[0][0].detail).toContain('Automatic analysis is unavailable')
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
      copy: 'Copy error',
      feedback: 'Send feedback',
      releases: 'Open releases',
      analysis:
        'Automatic analysis is unavailable. You can copy the error, send feedback, or open the official releases.'
    },
    {
      locale: 'zh-CN',
      ok: '确定',
      copy: '复制错误',
      feedback: '发送反馈',
      releases: '打开发布页',
      analysis: '自动分析不可用。你可以复制错误、发送反馈或打开官方发布页。'
    }
  ])(
    'reads $locale only after Electron is ready and shows that catalog without PreferenceService',
    async ({ locale, ok, copy, feedback, releases, analysis }) => {
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
        detail: analysis,
        buttons: [ok, copy, feedback, releases]
      })
      expect(JSON.stringify(showMessageBox.mock.calls[0][0])).not.toContain('[to be translated]')
      expect(showMessageBox.mock.calls[0][0].buttons[0]).not.toBe('dialog.support.ok')
    }
  )
})
