import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { t } from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { ipcApi } from '@renderer/ipc'
import { popupService } from '@renderer/services/popup'

import ImportMenuSettings from '../ImportMenuSettings'

vi.mock('@renderer/services/popup', async (original) => await original())
vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({ openConversation: vi.fn() })
}))

afterEach(() => {
  act(() => {
    for (const entry of popupService.getSnapshot()) popupService.settle(entry.instanceId, undefined)
  })
  cleanup()
  vi.restoreAllMocks()
})

// Catch routing the settings action to Assistant import or requiring an existing Agent.
it('opens Agent import directly and restores its latest progress', async () => {
  vi.spyOn(ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route === 'ai.agent.import.status' && input && typeof input === 'object' && Object.keys(input).length === 0) {
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
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(await screen.findByText('destination-only.pdf')).toBeInTheDocument()
  expect(screen.getByText(t('common.completed'))).toBeInTheDocument()
})
