import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { t } from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentImportSnapshot } from '@shared/ai/agentImport'

import { AgentImportDialog } from '../AgentImportPopup'

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({ openConversation: vi.fn() })
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const snapshot: AgentImportSnapshot = {
  id: 'import',
  agentId: 'agent',
  revision: 1,
  status: 'ready',
  conversations: 2,
  messages: 5,
  imported: 0,
  skipped: 0,
  failed: 0,
  remaining: 2,
  missingFiles: ['missing.pdf'],
  sessionIds: []
}

it('previews the archive before starting and restores background progress after reopening', async () => {
  let current: AgentImportSnapshot | null = null
  vi.spyOn(ipcApi, 'request').mockImplementation(async (route) => {
    if (route === 'ai.agent.import.status') return current as never
    if (route === 'ai.agent.import.prepare') return (current = snapshot) as never
    if (route === 'ai.agent.import.start') return (current = { ...snapshot, status: 'running', revision: 2 }) as never
    throw new Error(`Unexpected command ${route}`)
  })
  const first = render(<AgentImportDialog open resolve={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: t('common.select') }))
  expect(await screen.findByText('missing.pdf')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: t('common.stop') })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: t('agent.import.title') }))
  await screen.findByRole('button', { name: t('common.stop') })
  first.unmount()
  render(<AgentImportDialog open resolve={vi.fn()} />)
  expect(await screen.findByRole('button', { name: t('common.stop') })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: t('common.select') })).toBeDisabled()
})
