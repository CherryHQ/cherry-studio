import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import type { AgentMemoryFile } from '@shared/ipc/schemas/agent'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('react-i18next', () => {
  const t = (key: string) => en[key as keyof typeof en] ?? key
  return { useTranslation: () => ({ t, i18n: { language: 'en-US' } }) }
})

import { AgentMemoryPanel } from '../AgentMemoryPanel'

const file = (overrides: Partial<AgentMemoryFile>): AgentMemoryFile => ({
  key: 'soul',
  name: 'SOUL.md',
  path: '/agents/a1/SOUL.md',
  exists: true,
  size: 0,
  updatedAt: null,
  version: 'missing',
  content: '',
  truncated: false,
  ...overrides
})

const showSnapshot = (files: AgentMemoryFile[]) =>
  vi.mocked(ipcApi.request).mockResolvedValue({ directory: '/agents/a1', files })

describe('AgentMemoryPanel empty files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the editor from the placeholder when the memory file does not exist yet', async () => {
    const user = userEvent.setup()
    showSnapshot([file({ exists: false })])
    render(<AgentMemoryPanel agent={{ id: 'a1', name: 'Agent' }} />)

    expect(await screen.findByText(en['agent.memory.not_exists'])).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en['agent.memory.create'] }))

    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('explains why an empty read-only file offers no edit action', async () => {
    showSnapshot([file({ key: 'journal', name: 'JOURNAL.md', content: '' })])
    render(<AgentMemoryPanel agent={{ id: 'a1', name: 'Agent' }} />)

    const placeholder = (await screen.findByText(en['agent.memory.empty'])).closest<HTMLElement>(
      '[data-slot="empty-placeholder"]'
    )
    expect(placeholder).not.toBeNull()
    expect(within(placeholder!).getByText(en['agent.memory.journal_readonly'])).toBeInTheDocument()
    expect(within(placeholder!).queryByRole('button')).not.toBeInTheDocument()
  })
})
