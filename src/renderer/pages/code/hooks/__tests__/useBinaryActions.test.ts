import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBinaryActions } from '../useBinaryActions'

const ipcRequestMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => ipcRequestMock(...args)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useBinaryActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequestMock.mockResolvedValue({ version: '1.0.0' })
    window.toast = { error: vi.fn(), success: vi.fn() } as unknown as typeof window.toast
  })

  it('installs a CLI tool without pinning a version', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.install(CodeCli.CLAUDE_CODE)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      name: 'claude',
      tool: 'claude'
    })
    expect(window.toast.success).toHaveBeenCalledWith('code.install_success')
  })

  it('upgrades a CLI tool by pinning the detected latest version', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.upgrade(CodeCli.CLAUDE_CODE, '1.2.3')
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      name: 'claude',
      tool: 'claude',
      version: '1.2.3'
    })
    expect(window.toast.success).toHaveBeenCalledWith('code.upgrade_success')
    await waitFor(() => expect(result.current.upgradingTools.has(CodeCli.CLAUDE_CODE)).toBe(false))
  })
})
