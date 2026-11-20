import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { HeartbeatDocument } from '@shared/ipc/schemas/ai'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/components/PromptEditorField', () => ({
  PromptEditorIconButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  default: ({
    label,
    actions,
    value,
    onChange,
    placeholder,
    disabled,
    editorLabel
  }: {
    label?: ReactNode
    actions?: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    editorLabel?: string
  }) => (
    <div>
      {label}
      {actions}
      <textarea
        aria-label={editorLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}))
vi.mock('react-i18next', () => {
  const t = (key: string) => en[key as keyof typeof en] ?? key
  return { useTranslation: () => ({ t }) }
})

import { HeartbeatTasksPage } from '../HeartbeatTasksPage'

const original: HeartbeatDocument = {
  content: '',
  version: { mtime: 1, size: 0 },
  contentHash: ContentHashSchema.parse('xxh3:0000000000000000')
}

describe('HeartbeatTasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/agents/:agentId/heartbeat', { scheduleEnabled: true, latestRun: null })
    vi.mocked(ipcApi.request).mockResolvedValue(original)
  })

  it('waits for successful persistence before running the edited tasks', async () => {
    const user = userEvent.setup()
    let finishSave!: (value: HeartbeatDocument) => void
    const persisted: string[] = []
    vi.mocked(ipcApi.request).mockImplementation((async (route: string, input: unknown) => {
      if (route.endsWith('.read')) return original
      if (route.endsWith('.write')) {
        const doc = input as HeartbeatDocument
        await new Promise<HeartbeatDocument>((resolve) => {
          finishSave = resolve
        })
        persisted.push(doc.content)
        return doc
      }
      expect(persisted).toEqual(['Check the inbox'])
      return 'started'
    }) as typeof ipcApi.request)
    render(<HeartbeatTasksPage agentId="a1" enabled />)
    const editor = await screen.findByRole('textbox', { name: 'Heartbeat tasks' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Check the inbox')
    await user.click(screen.getByRole('button', { name: 'Save and run once' }))
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.agent.heartbeat.run', expect.anything())
    await act(async () => finishSave({ ...original, content: 'Check the inbox' }))
    expect(await screen.findByRole('status')).toHaveTextContent(en['agent.tasks.runTriggered'])
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('keeps the draft and never runs when an external edit conflicts with saving', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation((async (route: string) => {
      if (route.endsWith('.read')) return original
      throw new IpcError(fileErrorCodes.STALE_VERSION, 'Changed externally')
    }) as typeof ipcApi.request)
    render(<HeartbeatTasksPage agentId="a1" enabled />)
    const editor = await screen.findByRole('textbox', { name: 'Heartbeat tasks' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Save and run once' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en['agent.heartbeat.conflict'])
    expect(editor).toHaveValue('Keep this draft')
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.agent.heartbeat.run', expect.anything())
  })

  it('explains a failed last run instead of showing the raw provider error', async () => {
    const raw =
      'cherryin API error (401): {"error":{"code":"","message":"无效的令牌 (request id: 20261119104456)","type":"new_api_error"}}'
    MockUseDataApiUtils.mockQueryData('/agents/:agentId/heartbeat', {
      scheduleEnabled: true,
      latestRun: {
        status: 'failed',
        createdAt: '2026-11-19T02:44:54.000Z',
        output: null,
        error: { code: 'HANDLER_THREW', message: raw, retryable: true }
      } as never
    })
    render(<HeartbeatTasksPage agentId="a1" enabled />)
    expect(await screen.findByText(en['error.diagnosis.auth'])).toBeVisible()
    expect(screen.getByText(/无效的令牌/)).toBeVisible()
    expect(screen.queryByText(/new_api_error|\{"error"/)).not.toBeInTheDocument()
  })

  // Catches a 401-minute task timeout being read as HTTP 401 and diagnosed as an auth failure.
  it('keeps the timeout diagnosis when the timeout duration looks like an HTTP status', async () => {
    MockUseDataApiUtils.mockQueryData('/agents/:agentId/heartbeat', {
      scheduleEnabled: true,
      latestRun: {
        status: 'failed',
        createdAt: '2026-11-19T02:44:54.000Z',
        output: null,
        error: { code: 'HANDLER_THREW', message: 'Task timed out after 401 minute(s)', retryable: false }
      } as never
    })
    render(<HeartbeatTasksPage agentId="a1" enabled />)
    expect(await screen.findByText(en['error.diagnosis.network'])).toBeVisible()
    expect(screen.queryByText(en['error.diagnosis.auth'])).not.toBeInTheDocument()
  })

  it('allows editing a disabled heartbeat but prevents execution', async () => {
    const user = userEvent.setup()
    render(<HeartbeatTasksPage agentId="a1" enabled={false} />)
    const editor = await screen.findByRole('textbox', { name: 'Heartbeat tasks' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Check status')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save and run once' })).toBeDisabled()
    expect(screen.getByText(en['agent.heartbeat.enable_first'])).toBeVisible()
  })
})
