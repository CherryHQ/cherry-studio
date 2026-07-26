import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useRemoveCliToolDialog } from '../useRemoveCliToolDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('useRemoveCliToolDialog', () => {
  it('shows loading while the tool removal is in progress', async () => {
    let finishRemoval: () => void = () => {}
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve
    })
    const remove = vi.fn(() => removal)
    const { result } = renderHook(() => useRemoveCliToolDialog({ toolName: 'OpenCode', remove }))

    act(() => result.current.requestRemove(CodeCli.OPEN_CODE))

    let confirmRemoval: Promise<void> | undefined
    act(() => {
      confirmRemoval = result.current.removeDialogProps.onConfirm?.() as Promise<void>
    })

    expect(remove).toHaveBeenCalledWith(CodeCli.OPEN_CODE)
    expect(result.current.removeDialogProps.confirmLoading).toBe(true)

    await act(async () => {
      finishRemoval()
      await confirmRemoval
    })

    expect(result.current.removeDialogProps.confirmLoading).toBe(false)
  })
})
