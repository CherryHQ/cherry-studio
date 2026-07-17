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

  it('installs a CLI tool by name only, letting main resolve the recipe', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.install(CodeCli.CLAUDE_CODE)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', { name: 'claude' })
    expect(toast.success).toHaveBeenCalledWith('code.install_success')
  })

  it('upgrades by name with the detected latest version as a one-shot target', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.upgrade(CodeCli.CLAUDE_CODE, '1.2.3')
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      name: 'claude',
      targetVersion: '1.2.3'
    })
    expect(toast.success).toHaveBeenCalledWith('code.upgrade_success')
    await waitFor(() => expect(result.current.upgradingTools.has(CodeCli.CLAUDE_CODE)).toBe(false))
  })

  it('removes a CLI tool by sending the request object and reports success on removed', async () => {
    ipcRequestMock.mockResolvedValue({ status: 'removed' })
    const { result } = renderHook(() => useBinaryActions())

    let removed = false
    await act(async () => {
      removed = await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.remove_tool', { name: 'claude' })
    expect(removed).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('common.delete_success')
  })

  it('surfaces a fixed-tool cleanup_blocked as an error with no definition fallback', async () => {
    ipcRequestMock.mockResolvedValue({
      status: 'cleanup_blocked',
      reason: 'dependency_blocked',
      message: 'Cannot remove claude while installed tools depend on it: gemini'
    })
    const { result } = renderHook(() => useBinaryActions())

    let removed = true
    await act(async () => {
      removed = await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(removed).toBe(false)
    // A Code CLI is fixed — never a definition-only follow-up request.
    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Cannot remove claude while installed tools depend on it: gemini')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
