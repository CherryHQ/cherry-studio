import { toast } from '@renderer/services/toast'
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
  })

  it('installs a CLI tool without pinning a version', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.install(CodeCli.CLAUDE_CODE)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      intent: { name: 'claude', tool: 'claude' }
    })
    expect(toast.success).toHaveBeenCalledWith('code.install_success')
  })

  it('claims an already-installed CLI with its canonical intent and no version target', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.claim(CodeCli.CLAUDE_CODE)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.claim_tool', { name: 'claude', tool: 'claude' })
    expect(ipcRequestMock).not.toHaveBeenCalledWith('binary.install_tool', expect.anything())
    expect(toast.success).toHaveBeenCalledWith('code.claim_success')
  })

  it('preserves durable intent while using the detected latest version as a one-shot target', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.upgrade(CodeCli.CLAUDE_CODE, '1.2.3', {
        name: 'claude',
        tool: 'claude',
        requestedVersion: '1.0.0'
      })
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      intent: { name: 'claude', tool: 'claude', requestedVersion: '1.0.0' },
      targetVersion: '1.2.3'
    })
    expect(toast.success).toHaveBeenCalledWith('code.upgrade_success')
    await waitFor(() => expect(result.current.upgradingTools.has(CodeCli.CLAUDE_CODE)).toBe(false))
  })
})
