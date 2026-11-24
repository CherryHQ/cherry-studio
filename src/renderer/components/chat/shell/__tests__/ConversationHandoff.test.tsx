import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { UniqueModelId } from '@shared/data/types/model'

import { ConversationHandoff } from '../ConversationHandoff'
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const modelId = 'provider::model' as UniqueModelId
const save = vi.fn(async () => '/tmp/handoff.md')
beforeEach(() => {
  vi.clearAllMocks()
  window.api = { file: { save } } as never
  vi.mocked(ipcApi.request).mockResolvedValue('## Goals\nContinue the task' as never)
})
describe('ConversationHandoff', () => {
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
    const onNewTopic = vi.fn(async () => undefined)
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
    expect(payload.assistantId).toBe('assistant')
    expect(payload.handoffDraft.text).toBe('')
    expect(payload.handoffDraft.files).toHaveLength(1)
    expect(payload.handoffDraft.files[0].blob.size).toBe(14)
    expect(payload.handoffDraft.tokens[0].id).toBe(`file:${payload.handoffDraft.files[0].fileTokenSourceId}`)
    expect(save).not.toHaveBeenCalled()
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
