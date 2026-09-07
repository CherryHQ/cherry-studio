import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Map<string, (payload: any) => void>(),
  openConversation: vi.fn(),
  buildFiles: vi.fn(async () => [])
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(event, handler)
  }
}))
vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({ openConversation: mocks.openConversation })
}))
vi.mock('@renderer/utils/file/buildFileParts', () => ({ buildFilePartsForAttachments: mocks.buildFiles }))
vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  WorkspaceSelector: ({ trigger }: { trigger: ReactNode }) => trigger,
  AgentSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))
vi.mock('@cherrystudio/ui', () => ({
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  Checkbox: (props: ComponentProps<'input'>) => <input type="checkbox" {...props} />,
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  Textarea: Object.assign((props: ComponentProps<'textarea'>) => <textarea {...props} />, {
    Input: (props: ComponentProps<'textarea'>) => <textarea {...props} />,
    Root: (props: ComponentProps<'textarea'>) => <textarea {...props} />
  })
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { HandoffDraftOpenSchema } from '@shared/ipc/schemas/ai'

import { useAgentHandoff } from '../useAgentHandoff'

const source = { kind: 'topic' as const, id: 'topic-1' }
const target = { kind: 'agent-handoff', agentId: 'agent-1', name: 'Reviewer' }
const draft = { text: 'Review this change', tokens: [] }

function Harness({ sourceId = 'topic-1' }: { sourceId?: string }) {
  const handoff = useAgentHandoff({ sourceId })
  return (
    <>
      <button onClick={() => handoff.open(draft, target, source, [])}>open</button>
      <button onClick={() => void handoff.start()}>program-start</button>
      <button onClick={handoff.cancel}>program-cancel</button>
      {handoff.dialog}
    </>
  )
}

describe('useAgentHandoff', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.request.mockImplementation((route: string) =>
      route === 'ai.stream.abort'
        ? Promise.resolve(undefined)
        : Promise.resolve({ streamId: '', modelId: 'm', coverage: {}, attachments: [] })
    )
    mocks.listeners.clear()
    mocks.openConversation.mockReset()
    mocks.buildFiles.mockReset()
    mocks.buildFiles.mockResolvedValue([])
  })
  it('opens a review dialog without creating a session before confirmation', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    expect(HandoffDraftOpenSchema.safeParse(mocks.request.mock.calls[0][1]).success).toBe(true)
    expect(screen.getByRole('heading')).toBeTruthy()
    expect(mocks.openConversation).not.toHaveBeenCalled()
    await act(async () => {
      mocks.listeners.get('ai.stream.done')?.({ topicId: streamId, status: 'success' })
      resolve({ streamId, modelId: 'm', coverage: {}, attachments: [] })
    })
    expect(mocks.openConversation).not.toHaveBeenCalled()
  })

  it('aborts immediately and again when a cancelled open resolves late', async () => {
    let resolve!: (value: unknown) => void
    mocks.request.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    expect(streamId).toMatch(/^handoff:draft:/)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(mocks.request).toHaveBeenCalledWith('ai.stream.abort', expect.anything())
    await act(async () => resolve({ streamId: 'late', modelId: 'm', coverage: {}, attachments: [] }))
    expect(mocks.request.mock.calls.filter(([route]) => route === 'ai.stream.abort')).toHaveLength(2)
  })

  it('submits edited goal and summary with the same confirmation identity after a retry', async () => {
    const draftOpen = Promise.resolve({ streamId: 'handoff:draft:ready', modelId: 'm', coverage: {}, attachments: [] })
    mocks.request.mockImplementation((route: string) =>
      route === 'ai.agent.handoff.draft.open'
        ? draftOpen
        : route === 'ai.stream.abort'
          ? Promise.resolve(undefined)
          : Promise.reject(new Error('start failed'))
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    await act(async () => {
      mocks.listeners.get('ai.stream.done')?.({ topicId: streamId, status: 'success' })
      await draftOpen
    })
    fireEvent.change(screen.getByLabelText('agent.session.handoff.goal'), { target: { value: 'Edited goal' } })
    fireEvent.change(screen.getByLabelText('agent.session.handoff.summary'), { target: { value: 'Edited summary' } })
    fireEvent.click(screen.getByRole('button', { name: 'agent.session.handoff.start' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    const starts = mocks.request.mock.calls.filter(([route]) => route === 'ai.agent.handoff.start')
    expect(starts).toHaveLength(2)
    expect(starts[0][1]).toMatchObject({ goal: 'Edited goal', summary: 'Edited summary' })
    expect(starts[1][1]).toMatchObject({ goal: 'Edited goal', summary: 'Edited summary' })
    expect(starts[1][1].handoffId).toBe(starts[0][1].handoffId)
  })

  it('drops an in-flight dialog when the source conversation changes', () => {
    mocks.request.mockImplementationOnce(() => new Promise(() => undefined))
    const view = render(<Harness sourceId="topic-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByRole('heading')).toBeTruthy()
    view.rerender(<Harness sourceId="topic-2" />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(mocks.request.mock.calls.some(([route]) => route === 'ai.stream.abort')).toBe(true)
  })

  it('sends only one start request when confirmation is clicked twice', async () => {
    mocks.request.mockImplementation((route: string) =>
      route === 'ai.agent.handoff.draft.open'
        ? Promise.resolve({ streamId: 'unused', modelId: 'm', coverage: {}, attachments: [] })
        : route === 'ai.agent.handoff.start'
          ? new Promise(() => undefined)
          : Promise.resolve(undefined)
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    await act(async () => mocks.listeners.get('ai.stream.done')?.({ topicId: streamId, status: 'success' }))
    const start = screen.getByRole('button', { name: 'agent.session.handoff.start' })
    await act(async () => {
      fireEvent.click(start)
      fireEvent.click(start)
    })
    expect(mocks.request.mock.calls.filter(([route]) => route === 'ai.agent.handoff.start')).toHaveLength(1)
  })

  it('does not start after cancellation while attachment parts are still building', async () => {
    let resolveFiles!: (value: never[]) => void
    mocks.buildFiles.mockImplementationOnce(() => new Promise((resolve) => (resolveFiles = resolve)))
    mocks.request.mockImplementation((route: string) =>
      route === 'ai.agent.handoff.draft.open'
        ? Promise.resolve({ streamId: 'unused', modelId: 'm', coverage: {}, attachments: [] })
        : Promise.resolve(undefined)
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    await act(async () => mocks.listeners.get('ai.stream.done')?.({ topicId: streamId, status: 'success' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.session.handoff.start' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await act(async () => resolveFiles([]))
    expect(mocks.request.mock.calls.some(([route]) => route === 'ai.agent.handoff.start')).toBe(false)
  })

  it('keeps a created session recoverable when start reports an error', async () => {
    mocks.request.mockImplementation((route: string) =>
      route === 'ai.agent.handoff.draft.open'
        ? Promise.resolve({ streamId: 'unused', modelId: 'm', coverage: {}, attachments: [] })
        : route === 'ai.agent.handoff.start'
          ? Promise.resolve({ sessionId: 'session-1', state: 'created', error: { message: 'delivery failed' } })
          : Promise.resolve(undefined)
    )
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const streamId = mocks.request.mock.calls[0][1].streamId
    await act(async () => mocks.listeners.get('ai.stream.done')?.({ topicId: streamId, status: 'success' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.session.handoff.start' }))
    await act(async () => {})
    const openAgent = screen.getByRole('button', { name: 'agent.session.handoff.open_agent' })
    expect(openAgent).toBeTruthy()
    fireEvent.click(openAgent)
    expect(mocks.openConversation).toHaveBeenCalledWith('session-1', 'Reviewer')
  })
})
