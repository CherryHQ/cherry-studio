import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, expect, it, vi } from 'vitest'

import { TaskFormDialog } from '@renderer/components/ScheduledTask/TaskFormDialog'
import { dataApiService } from '@renderer/data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import en from '@renderer/i18n/locales/en-us.json'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.mock('@renderer/hooks/agent/useChannels', () => {
  const result = { channels: [], isLoading: false, error: undefined }
  return { useChannels: () => result }
})
vi.mock('@renderer/components/PromptEditorField', () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="Prompt" value={value} readOnly />
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions', () => ({
  PromptPolishActions: () => null
}))
const i18n = createInstance()
beforeAll(async () => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})

it.each(['save', 'cancel'] as const)('handles a pending automatic reset on %s', async (action) => {
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
    if (path === '/agent-workspaces') return [] as never
    if (path === '/agent-sessions') return { items: [], nextCursor: null } as never
    return null as never
  })
  const task: ScheduledTaskEntity = {
    id: 'lost-task',
    agentId: 'agent-a',
    name: 'Report',
    prompt: 'Summarise',
    trigger: { kind: 'interval', ms: 60_000 },
    timeoutMinutes: 5,
    workspace: { type: 'system' },
    reuseSession: true,
    reuseSessionId: null,
    reuseBindingLost: true,
    reuseBindingLostSessionName: 'Missing conversation',
    enabled: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
  const update = vi.fn(async () => true)
  const close = vi.fn()
  const { Wrapper } = createSWRTestWrapper()
  render(
    <Wrapper>
      <I18nextProvider i18n={i18n}>
        <TaskFormDialog
          open
          agents={[{ id: 'agent-a', name: 'Agent' }]}
          task={task}
          onOpenChange={close}
          onUpdate={update}
        />
      </I18nextProvider>
    </Wrapper>
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('combobox', { name: 'Session to reuse' }))
  await user.click(await screen.findByRole('option', { name: 'New session on first run' }))
  await user.click(screen.getByRole('button', { name: action === 'save' ? 'Save' : 'Cancel' }))
  if (action === 'save') {
    await waitFor(() => expect(update).toHaveBeenCalledWith({ reuseSessionId: null }))
  } else {
    expect(close).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  }
})
