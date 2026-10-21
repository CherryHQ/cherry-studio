import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastViewport } from '@cherrystudio/ui/components/primitives/toast'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { ActiveExecution, StreamErrorPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'

import { useConversationErrorToasts } from '../useConversationErrorToasts'

vi.mock('@cherrystudio/ui', async () => await import('@cherrystudio/ui/components/primitives/toast'))
vi.mock('@renderer/services/toast', async (original) => await original())
vi.mock('@renderer/hooks/command', () => ({ useCommandRuntime: () => ({ hasHandler: () => false }) }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))
vi.mock('@renderer/services/website', () => ({ openExternalWebsite: vi.fn() }))
const { listeners } = vi.hoisted(() => ({ listeners: new Map<string, (event: StreamErrorPayload) => void>() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: (name: string, callback: (event: StreamErrorPayload) => void) => {
      listeners.set(name, callback)
      return () => {
        listeners.delete(name)
      }
    }
  }
}))

const modelId = 'openai::gpt-test'
const message: CherryUIMessage = { id: 'assistant-1', role: 'assistant', parts: [], metadata: { parentId: 'user-1' } }
const execution = { executionId: modelId, attemptId: 1, anchorMessageId: message.id } as ActiveExecution
const opaque = { name: null, message: null, stack: null }

describe('useConversationErrorToasts terminal feedback', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })
  afterEach(() => {
    act(() => toast.closeAll())
  })

  function setup(retry?: (message: CherryUIMessage, modelId: UniqueModelId) => Promise<void>) {
    const hook = renderHook(({ scope }) => useConversationErrorToasts(scope, { retry }), {
      initialProps: { scope: 'topic-1' }
    })
    render(<ToastViewport />)
    return hook
  }
  function finish(hook: ReturnType<typeof setup>, error: SerializedError | undefined, attemptId = 1, isAbort = false) {
    act(() =>
      hook.result.current.onFinish(modelId, {
        attemptId,
        message: { ...message, parts: error ? [{ type: 'data-error', data: error }] : [] },
        isError: true,
        isAbort
      })
    )
  }

  it.each([
    [
      'en-US',
      'Response failed',
      'No readable error details were received. Please retry; if it happens again, check the logs.',
      'Retry'
    ],
    ['zh-CN', '响应失败', '未收到可读的错误详情。请重试；若再次发生，请查看日志。', '重试']
  ])(
    '[22243 RED] handles an error completion with no error part consistently in %s',
    async (language, title, description, retryLabel) => {
      await i18n.changeLanguage(language)
      let completed = false
      const retry = vi.fn(async () => {
        act(() => hook.result.current.track([{ ...execution, attemptId: 2 }], [message]))
        act(() => hook.result.current.onFinish(modelId, { attemptId: 2, message, isError: false, isAbort: false }))
        completed = true
      })
      const hook = setup(retry)
      act(() => hook.result.current.track([execution], [message]))
      finish(hook, undefined)
      expect(await screen.findByText(title)).toBeInTheDocument()
      expect(screen.getByText((text) => text.startsWith(description))).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: retryLabel }))
      await waitFor(() => expect(completed).toBe(true))
      expect(retry).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.getByText(i18n.t('common.success'))).toBeInTheDocument())
    }
  )

  it('shows a serialized provider code in terminal error feedback', async () => {
    const hook = setup()
    act(() => hook.result.current.track([execution], [message]))
    finish(hook, { name: 'Error', message: '', stack: null, providerErrorCode: 'ECONNRESET' })
    expect(await screen.findByText((text) => text.includes('ECONNRESET'))).toBeInTheDocument()
    expect(screen.queryByText((text) => text.includes(i18n.t('error.stream_unreadable.description')))).toBeNull()
  })

  it('[22243 RED] re-evaluates an unreadable retry failure', async () => {
    const retry = vi
      .fn()
      .mockRejectedValueOnce(opaque)
      .mockRejectedValueOnce({ name: 'Error', message: null, stack: null, statusCode: 401 })
    const hook = setup(retry)
    act(() => hook.result.current.track([execution], [message]))
    finish(hook, opaque)
    expect(await screen.findByText('Response failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('toast.error.retry') }))
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Response failed')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('toast.error.retry') })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: i18n.t('toast.error.retry') }))
    expect(await screen.findByText(i18n.t('error.diagnosis.auth'))).toBeInTheDocument()
    expect(screen.queryByText('Response failed')).toBeNull()
    expect(screen.getByRole('button', { name: i18n.t('toast.error.configure') })).toBeInTheDocument()
  })

  it('[22243 invariant] does not add retry to unrelated unknown errors', async () => {
    const hook = setup(vi.fn())
    await act(() => hook.result.current.report(new Error('ordinary business failure'), modelId, message))
    expect(screen.queryByRole('button', { name: i18n.t('toast.error.retry') })).toBeNull()
    expect(screen.queryByText('Response failed')).toBeNull()
  })

  it('[22243 invariant] ignores aborted passive duplicate and stale attempts', async () => {
    const retry = vi.fn()
    const hook = setup(retry)
    finish(hook, { ...opaque, message: 'network error' })
    expect(toast.getToastQueue().toasts).toHaveLength(0)
    act(() => hook.result.current.track([execution], [message]))
    await waitFor(() => expect(toast.getToastQueue().toasts).toHaveLength(1))
    const staleAction = toast.getToastQueue().toasts[0].action!.onClick
    act(() =>
      listeners.get('ai.stream.error')!({
        topicId: 'topic-1',
        executionId: modelId,
        attemptId: 1,
        anchorMessageId: message.id,
        error: { ...opaque, message: 'network error' }
      })
    )
    finish(hook, { ...opaque, message: 'network error' })
    expect(toast.getToastQueue().toasts).toHaveLength(1)
    act(() => toast.closeAll())
    act(() => hook.result.current.track([{ ...execution, attemptId: 2 }], [message]))
    finish(hook, opaque, 2, true)
    expect(toast.getToastQueue().toasts).toHaveLength(0)
    hook.rerender({ scope: 'other' })
    await act(async () => {
      await staleAction()
    })
    expect(retry).not.toHaveBeenCalled()
    finish(hook, opaque, 3)
    expect(toast.getToastQueue().toasts).toHaveLength(0)
  })

  it('[22243 invariant] does not invent a retry capability', async () => {
    const hook = setup()
    act(() => hook.result.current.track([execution], [message]))
    finish(hook, opaque)
    await waitFor(() => expect(toast.getToastQueue().toasts).toHaveLength(1))
    expect(screen.queryByRole('button', { name: i18n.t('toast.error.retry') })).toBeNull()
  })
  it.each(['en-US', 'zh-CN'])(
    '[22243 RED] offers retry for an unreadable accepted stream failure in either locale: %s',
    async (language) => {
      await i18n.changeLanguage(language)
      const retry = vi.fn(async () => {
        act(() => hook.result.current.track([{ ...execution, attemptId: 2 }], [message]))
        act(() => hook.result.current.onFinish(modelId, { attemptId: 2, message, isError: false, isAbort: false }))
      })
      const hook = setup(retry)
      act(() => hook.result.current.track([execution], [message]))
      act(() =>
        listeners.get('ai.stream.error')!({
          topicId: 'topic-1',
          executionId: modelId,
          attemptId: 1,
          anchorMessageId: message.id,
          error: opaque
        })
      )
      expect(await screen.findByText(i18n.t('error.stream_unreadable.title'))).toBeInTheDocument()
      expect(
        screen.getByText((text) => text.startsWith(i18n.t('error.stream_unreadable.description')))
      ).toBeInTheDocument()
      finish(hook, opaque)
      expect(toast.getToastQueue().toasts).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: i18n.t('toast.error.retry') }))
      expect(await screen.findByText(i18n.t('common.success'))).toBeInTheDocument()
      expect(retry).toHaveBeenCalledTimes(1)
    }
  )
})
