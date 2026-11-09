import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { CodeCli } from '@shared/types/codeCli'

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
  useTranslation: () => ({
    t: (key: string, options?: { dependents?: string }) => (options?.dependents ? `${key}:${options.dependents}` : key)
  })
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

  it('forwards a retry target version so a failed update repeats the same targeted install', async () => {
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.install(CodeCli.CLAUDE_CODE, '1.2.3')
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('binary.install_tool', {
      name: 'claude',
      targetVersion: '1.2.3'
    })
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
    expect(toast.success).toHaveBeenCalledWith('settings.dependencies.uninstallSuccess')
  })

  it('names the dependent tools blocking a fixed-tool removal, with no definition fallback', async () => {
    ipcRequestMock.mockResolvedValue({
      status: 'cleanup_blocked',
      reason: 'dependency_blocked',
      dependents: ['gemini', 'qwen'],
      message: 'Cannot remove claude while installed tools depend on it: gemini, qwen'
    })
    const { result } = renderHook(() => useBinaryActions())

    let removed = true
    await act(async () => {
      removed = await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(removed).toBe(false)
    // A Code CLI is fixed — never a definition-only follow-up request.
    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    // Stopping a dependent is the user's fix, not a fault to report.
    expect(toast.error).toHaveBeenCalledWith({
      title: 'settings.dependencies.uninstallFailed',
      description: 'settings.dependencies.removeDefinitionOnlyDependents:gemini, qwen',
      data: { suppressDetail: true }
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows why a fixed-tool cleanup could not run and keeps it reportable', async () => {
    ipcRequestMock.mockResolvedValue({
      status: 'cleanup_blocked',
      reason: 'cleanup_failed',
      message: 'Tool is still installed after removal: claude'
    })
    const { result } = renderHook(() => useBinaryActions())

    await act(async () => {
      await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.dependencies.uninstallFailed',
        description: 'Tool is still installed after removal: claude',
        cause: expect.objectContaining({ message: 'Tool is still installed after removal: claude' }),
        data: { source: 'code.dependencies', operation: 'binary.remove_tool' }
      })
    )
  })

  it('keeps a thrown remove rejection and allows the same removal to be retried', async () => {
    const failure = new Error('remove ipc rejected')
    ipcRequestMock.mockRejectedValueOnce(failure).mockResolvedValueOnce({ status: 'removed' })
    const { result } = renderHook(() => useBinaryActions())

    let removed = true
    await act(async () => {
      removed = await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(removed).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({
            message: 'remove ipc rejected',
            operation: 'binary.remove_tool',
            source: 'code.dependencies'
          }),
          localizedErrorMessage: 'settings.dependencies.uninstallFailed'
        }),
        title: 'settings.dependencies.uninstallFailed'
      })
    )
    expect(toast.error).not.toHaveBeenCalledWith('settings.dependencies.uninstallFailed')

    await act(async () => {
      removed = await result.current.remove(CodeCli.CLAUDE_CODE)
    })

    expect(removed).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('settings.dependencies.uninstallSuccess')
  })
})
