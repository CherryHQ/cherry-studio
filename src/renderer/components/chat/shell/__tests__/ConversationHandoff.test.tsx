import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AddNewTopicPayload } from '@renderer/components/composer/variants/shared/composerProviderActions'
import { ipcApi } from '@renderer/ipc'
import type { Model, UniqueModelId } from '@shared/data/types/model'

import { ConversationHandoff } from '../ConversationHandoff'
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const modelId = 'provider::model' as UniqueModelId
const save = vi.fn(async () => '/tmp/handoff.md')
beforeEach(() => {
  vi.clearAllMocks()
  window.api = { file: { save } } as never
  vi.mocked(ipcApi.request).mockResolvedValue('## Goals\nContinue the task')
})
describe('ConversationHandoff', () => {
  it('lets the user choose a handoff model when several composer models are selected', async () => {
    const models = [
      { id: 'provider::a', name: 'Model A' },
      { id: 'provider::b', name: 'Model B' }
    ] as unknown as Model[]
    render(<ConversationHandoff sessionId="multi-model" hasMessages modelCandidates={models} />)
    expect(screen.getByText('handoff.create')).toBeEnabled()
    fireEvent.click(screen.getByText('handoff.create'))
    // Generation stays unavailable until the user picks the destination model.
    expect(screen.getByText('handoff.generate')).toBeDisabled()
    fireEvent.click(screen.getByText('handoff.model'))
    fireEvent.click(await screen.findByText('Model B'))
    expect(screen.getByText('handoff.generate')).toBeEnabled()
    fireEvent.click(screen.getByText('handoff.generate'))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith(
        'ai.handoff.generate',
        expect.objectContaining({ sessionId: 'multi-model', modelId: 'provider::b' })
      )
    )
  })
  it('offers at 80% without generating, saving or attaching', () => {
    const onNewTopic = vi.fn()
    const { rerender } = render(
      <ConversationHandoff sessionId="topic" modelId={modelId} hasMessages percentage={79} onNewTopic={onNewTopic} />
    )
    expect(screen.queryByRole('status')).toBeNull()
    rerender(
      <ConversationHandoff sessionId="topic" modelId={modelId} hasMessages percentage={80} onNewTopic={onNewTopic} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('handoff.offer')
    fireEvent.click(screen.getByText('common.close'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(onNewTopic).not.toHaveBeenCalled()
  })
  it('keeps the dismissed offer hidden after a remount for the same session', () => {
    const { unmount } = render(
      <ConversationHandoff sessionId="dismissed-topic" modelId={modelId} hasMessages percentage={85} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('handoff.offer')
    fireEvent.click(screen.getByText('common.close'))
    expect(screen.queryByRole('status')).toBeNull()
    unmount()
    render(<ConversationHandoff sessionId="dismissed-topic" modelId={modelId} hasMessages percentage={85} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('requires generation and explicit saving, and exports the edited text', async () => {
    render(<ConversationHandoff sessionId="topic" modelId={modelId} hasMessages />)
    fireEvent.click(screen.getByText('handoff.create'))
    expect(ipcApi.request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('handoff.generate'))
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Reviewed text, no secrets' } })
    fireEvent.click(screen.getByText('handoff.save'))
    expect(save).toHaveBeenCalledWith('conversation-handoff.md', 'Reviewed text, no secrets')
  })
  it('seeds only the reviewed artifact in a fresh same-assistant draft without sending', async () => {
    const onNewTopic = vi.fn<(payload?: AddNewTopicPayload) => Promise<void>>(async () => undefined)
    render(
      <ConversationHandoff
        sessionId="old"
        modelId={modelId}
        assistantId="assistant"
        hasMessages
        onNewTopic={onNewTopic}
      />
    )
    fireEvent.click(screen.getByText('handoff.create'))
    fireEvent.click(screen.getByText('handoff.generate'))
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Edited handoff' } })
    fireEvent.click(screen.getByText('handoff.new'))
    await waitFor(() => expect(onNewTopic).toHaveBeenCalledTimes(1))
    const payload = onNewTopic.mock.calls[0][0]
    expect(payload?.assistantId).toBe('assistant')
    expect(payload?.handoffDraft?.text).toBe('')
    expect(payload?.handoffDraft?.files).toHaveLength(1)
    expect(payload?.handoffDraft?.files[0]?.blob?.size).toBe(14)
    expect(payload?.handoffDraft?.tokens[0]?.id).toBe(`file:${payload?.handoffDraft?.files[0]?.fileTokenSourceId}`)
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps a handoff from an unlinked topic unlinked in the new-topic payload', async () => {
    const onNewTopic = vi.fn<(payload?: AddNewTopicPayload) => Promise<void>>(async () => undefined)
    render(<ConversationHandoff sessionId="old" modelId={modelId} hasMessages onNewTopic={onNewTopic} />)
    fireEvent.click(screen.getByText('handoff.create'))
    fireEvent.click(screen.getByText('handoff.generate'))
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Edited handoff' } })
    fireEvent.click(screen.getByText('handoff.new'))
    await waitFor(() => expect(onNewTopic).toHaveBeenCalledTimes(1))
    // Explicit null, never undefined: the resolver must not link a route,
    // last-used or first assistant to an unlinked source topic.
    expect(onNewTopic.mock.calls[0][0]?.assistantId).toBeNull()
  })
  it('ignores late generation after cancel and aborts the request', async () => {
    let resolve!: (value: string) => void
    vi.mocked(ipcApi.request).mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done
        }) as never
    )
    render(<ConversationHandoff sessionId="topic" modelId={modelId} hasMessages />)
    fireEvent.click(screen.getByText('handoff.create'))
    fireEvent.click(screen.getByText('handoff.generate'))
    fireEvent.click(screen.getByText('common.cancel'))
    resolve('late private draft')
    fireEvent.click(screen.getByText('handoff.create'))
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(ipcApi.request).toHaveBeenCalledWith('ai.text.abort', expect.anything())
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps errors retryable and has no controls for empty conversations', async () => {
    const { rerender } = render(<ConversationHandoff sessionId="empty" modelId={modelId} hasMessages={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ConversationHandoff sessionId="topic" modelId={modelId} hasMessages />)
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('provider'))
    fireEvent.click(screen.getByText('handoff.create'))
    fireEvent.click(screen.getByText('handoff.generate'))
    expect(await screen.findByRole('alert')).toHaveTextContent('handoff.error')
    fireEvent.click(screen.getByText('handoff.generate'))
    expect(await screen.findByRole('textbox')).toBeVisible()
    expect(save).not.toHaveBeenCalled()
  })
})
