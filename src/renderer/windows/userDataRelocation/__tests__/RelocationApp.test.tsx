import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type RelocationProgress, UserDataRelocationIpcChannels } from '@shared/types/userDataRelocation'

import { relocationLocales } from '../i18n/locales'
import RelocationApp from '../RelocationApp'

const invoke = vi.fn()

const { useRelocationProgressMock } = vi.hoisted(() => ({ useRelocationProgressMock: vi.fn() }))
const restartMock = vi.fn()

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useRelocationProgress', () => ({ useRelocationProgress: useRelocationProgressMock }))

beforeEach(() => {
  restartMock.mockReset()
  invoke.mockReset().mockResolvedValue(true)
  useRelocationProgressMock.mockReturnValue({ progress: null, restart: restartMock })
  vi.spyOn(window, 'open').mockReturnValue(null)
  ;(window as unknown as { electron: { ipcRenderer: { invoke: typeof invoke } } }).electron = {
    ipcRenderer: { invoke }
  }
})

afterEach(() => {
  vi.mocked(window.open).mockRestore()
})

describe('RelocationApp', () => {
  it.each([
    { state: 'before the first progress event', progress: null, label: 'relocation.preparing' },
    { state: 'while preparing', progress: makeProgress('preparing'), label: 'relocation.preparing' },
    { state: 'while committing', progress: makeProgress('committing'), label: 'relocation.committing' }
  ])('shows a status $state', ({ progress, label }) => {
    useRelocationProgressMock.mockReturnValue({ progress, restart: restartMock })

    render(<RelocationApp />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows determinate copy progress and both relocation paths', () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('copying', { bytesCopied: 45, bytesTotal: 100 }),
      restart: restartMock
    })

    render(<RelocationApp />)

    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('/old/data')).toBeInTheDocument()
    expect(screen.getByText('/new/data')).toBeInTheDocument()
  })

  it('offers restart after a completed relocation', () => {
    useRelocationProgressMock.mockReturnValue({ progress: makeProgress('completed'), restart: restartMock })

    render(<RelocationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'relocation.restart_success' }))

    expect(screen.getByText('relocation.completed.description')).toBeInTheDocument()
    expect(restartMock).toHaveBeenCalledOnce()
  })

  it('shows the failure detail and offers continuing with the previous directory', () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('failed', { error: 'disk full' }),
      restart: restartMock
    })

    render(<RelocationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'relocation.restart_failure' }))

    expect(screen.getByText('disk full')).toBeInTheDocument()
    expect(screen.getByText('relocation.support.analysis_unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'relocation.support.releases' })).toBeInTheDocument()
    expect(screen.getByText('relocation.failed.description')).toBeInTheDocument()
    expect(restartMock).toHaveBeenCalledOnce()
  })

  it('asks main to open feedback and releases and keeps retry available when the open fails', async () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('failed', { error: 'disk full' }),
      restart: restartMock
    })
    invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    render(<RelocationApp />)
    fireEvent.click(screen.getByRole('button', { name: 'relocation.support.feedback' }))

    expect(await screen.findByText('relocation.support.open_failed')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith(UserDataRelocationIpcChannels.OpenSupportLink, 'feedback')
    expect(window.open).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'relocation.support.feedback' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'relocation.restart_failure' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'relocation.support.releases' }))
    await waitFor(() => {
      expect(screen.queryByText('relocation.support.open_failed')).not.toBeInTheDocument()
    })

    expect(invoke).toHaveBeenLastCalledWith(UserDataRelocationIpcChannels.OpenSupportLink, 'releases')
    expect(window.open).not.toHaveBeenCalled()
    expect(relocationLocales.en.translation.relocation.support.open_failed).toBe('Could not open the link. Try again.')
    expect(relocationLocales['zh-CN'].translation.relocation.support.open_failed).toBe('无法打开链接，请重试。')
    expect(relocationLocales['zh-TW'].translation.relocation.support.open_failed).toBe('無法開啟連結，請再試一次。')
  })

  it('shows a copy failure after clipboard denial and clears it when retry succeeds', async () => {
    useRelocationProgressMock.mockReturnValue({
      progress: makeProgress('failed', { error: 'disk full' }),
      restart: restartMock
    })
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    const clipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    try {
      render(<RelocationApp />)
      fireEvent.click(screen.getByRole('button', { name: 'relocation.support.copy' }))

      expect(await screen.findByText('relocation.support.copy_failed')).toBeInTheDocument()
      expect(screen.getByText('disk full')).toBeInTheDocument()
      expect(screen.queryByText('relocation.support.open_failed')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'relocation.support.copy' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'relocation.restart_failure' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'relocation.support.copy' }))
      await waitFor(() => {
        expect(screen.queryByText('relocation.support.copy_failed')).not.toBeInTheDocument()
      })

      expect(writeText).toHaveBeenNthCalledWith(1, 'disk full')
      expect(writeText).toHaveBeenNthCalledWith(2, 'disk full')
      expect(screen.getByText('disk full')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'relocation.support.feedback' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'relocation.support.releases' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'relocation.restart_failure' })).toBeEnabled()
      expect(relocationLocales.en.translation.relocation.support.copy_failed).toBe(
        'Could not copy the error. Try again.'
      )
      expect(relocationLocales['zh-CN'].translation.relocation.support.copy_failed).toBe('无法复制错误，请重试。')
      expect(relocationLocales['zh-TW'].translation.relocation.support.copy_failed).toBe('無法複製錯誤，請再試一次。')
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    }
  })
})

function makeProgress(
  stage: RelocationProgress['stage'],
  overrides: Partial<RelocationProgress> = {}
): RelocationProgress {
  return {
    stage,
    from: '/old/data',
    to: '/new/data',
    bytesCopied: 0,
    bytesTotal: 0,
    ...overrides
  }
}
