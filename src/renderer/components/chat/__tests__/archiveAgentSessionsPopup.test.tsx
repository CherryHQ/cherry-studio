import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { archiveAgentSessionsPopup } from '@renderer/components/chat/archiveAgentSessionsPopup'
import { PopupHost } from '@renderer/components/PopupHost'
import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of popupService.getSnapshot()) popupService.settle(entry.instanceId, false)
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Guard the real confirmation boundary: named, counted copy before any archive request.
describe('archive Agent conversations confirmation', () => {
  it.each(['confirm', 'cancel'] as const)('sends the archive request only on %s', async (choice) => {
    const user = userEvent.setup()
    const request = vi.spyOn(ipcApi, 'request').mockResolvedValue({ deletedIds: ['session-1'] })
    render(<PopupHost />)
    let result!: Promise<boolean>
    act(() => {
      result = archiveAgentSessionsPopup.show({
        agentName: 'Alpha Agent',
        sessionCount: 3,
        t: i18n.t,
        action: async () => {
          await ipcApi.request('ai.agent.sessions.delete', { agentId: 'agent-a' })
        }
      })
    })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive all conversations of “Alpha Agent” (3 total)?')
    expect(screen.getByRole('dialog')).toHaveTextContent('The Agent will be kept.')
    expect(request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: choice === 'confirm' ? 'Archive' : 'Cancel' }))
    await expect(result).resolves.toBe(choice === 'confirm')
    if (choice === 'confirm')
      expect(request).toHaveBeenCalledExactlyOnceWith('ai.agent.sessions.delete', { agentId: 'agent-a' })
    else expect(request).not.toHaveBeenCalled()
  })

  it('omits the count when the host cannot provide it', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    act(() => {
      void archiveAgentSessionsPopup.show({ agentName: 'Alpha Agent', t: i18n.t, action: vi.fn() })
    })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Archive all conversations of “Alpha Agent”?')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  })
})
