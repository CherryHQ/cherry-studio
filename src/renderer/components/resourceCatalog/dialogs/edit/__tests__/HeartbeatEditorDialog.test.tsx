import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { HeartbeatDocument } from '@shared/ipc/schemas/ai'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => {
  const t = (key: string) => en[key as keyof typeof en] ?? key
  return { useTranslation: () => ({ t }) }
})

import { HeartbeatEditorDialog } from '../HeartbeatEditorDialog'

const original: HeartbeatDocument = {
  content: '',
  version: { mtime: 1, size: 0 },
  contentHash: ContentHashSchema.parse('xxh3:0000000000000000')
}

describe('HeartbeatEditorDialog', () => {
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
    render(<HeartbeatEditorDialog agentId="a1" enabled onOpenChange={vi.fn()} />)
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
    render(<HeartbeatEditorDialog agentId="a1" enabled onOpenChange={vi.fn()} />)
    const editor = await screen.findByRole('textbox', { name: 'Heartbeat tasks' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Save and run once' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en['agent.heartbeat.conflict'])
    expect(editor).toHaveValue('Keep this draft')
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.agent.heartbeat.run', expect.anything())
  })

  it('allows editing a disabled heartbeat but prevents execution', async () => {
    const user = userEvent.setup()
    render(<HeartbeatEditorDialog agentId="a1" enabled={false} onOpenChange={vi.fn()} />)
    const editor = await screen.findByRole('textbox', { name: 'Heartbeat tasks' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, 'Check status')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save and run once' })).toBeDisabled()
    expect(screen.getByText(en['agent.heartbeat.enable_first'])).toBeVisible()
  })
})
