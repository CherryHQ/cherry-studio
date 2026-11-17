import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { t } from 'i18next'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { PopupHost } from '@renderer/components/PopupHost'
import { ipcApi } from '@renderer/ipc'
import { popupService } from '@renderer/services/popup'

import ImportMenuSettings from '../ImportMenuSettings'

vi.mock('@renderer/services/popup', async (original) => await original())
vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({ openConversation: vi.fn() })
}))
vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({
    trigger,
    onChange
  }: {
    trigger: ReactNode
    onChange: (item: { id: string; name: string }) => void
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange({ id: 'destination', name: 'Destination Agent' })}>
        Destination Agent
      </button>
    </div>
  )
}))

afterEach(() => {
  act(() => {
    for (const entry of popupService.getSnapshot()) popupService.settle(entry.instanceId, undefined)
  })
  cleanup()
  vi.restoreAllMocks()
})

// Catch routing the settings action to ordinary Assistant import or losing the selected Agent.
it('requires a destination and opens Agent import with that destination’s progress', async () => {
  vi.mocked(dataApiService.get).mockResolvedValue({ type: 'pi-durable' })
  vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
    if (
      route === 'ai.agent.import.status' &&
      input &&
      typeof input === 'object' &&
      'agentId' in input &&
      input.agentId === 'destination'
    ) {
      return {
        id: 'operation',
        agentId: 'destination',
        revision: 1,
        status: 'completed',
        conversations: 2,
        messages: 5,
        imported: 2,
        skipped: 0,
        failed: 0,
        remaining: 0,
        missingFiles: ['destination-only.pdf'],
        sessionIds: []
      } as never
    }
    throw new Error('Wrong import destination')
  })
  const { container } = render(
    <>
      <ImportMenuSettings />
      <PopupHost />
    </>
  )
  const row = within(container.querySelector('#setting-data-import-deepseek') as HTMLElement)
  const button = row.getByRole('button', { name: t('settings.data.import_settings.button') })
  expect(button).toBeDisabled()
  fireEvent.click(row.getByRole('button', { name: 'Destination Agent' }))
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(await screen.findByText('destination-only.pdf')).toBeInTheDocument()
  expect(screen.getByText(t('common.completed'))).toBeInTheDocument()
})
