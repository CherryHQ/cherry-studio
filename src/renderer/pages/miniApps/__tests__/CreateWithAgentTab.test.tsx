import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import CreateWithAgentTab from '../CreateWithAgentTab'

const { request, handOffAgentDraft, navigate } = vi.hoisted(() => ({
  request: vi.fn(),
  handOffAgentDraft: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/agentDraftHandoff', () => ({ handOffAgentDraft }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

let previousLanguage: string
beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

beforeEach(() => {
  request.mockReset()
  handOffAgentDraft.mockReset()
  navigate.mockReset()
})

const skillEntry = {
  id: 'skill-1',
  name: 'cherry-miniapp',
  folderName: 'cherry-miniapp',
  description: null,
  source: 'zip',
  sourceUrl: null,
  namespace: null,
  author: null,
  version: null,
  sourceTags: [],
  contentHash: 'x',
  isGlobalEnabled: true,
  isEnabled: true,
  mirrorEnabled: false,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
  scope: 'local' as const
}

describe('CreateWithAgentTab (AC7)', () => {
  it('guides the skill import when cherry-miniapp is not installed, and starts nothing', async () => {
    request.mockResolvedValueOnce([])
    const onClose = vi.fn()
    render(<CreateWithAgentTab onClose={onClose} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // AC12: the prompt limits the host to generation and packaging; it must
    // not claim preview, real-runtime testing or installation.
    expect(alert).toHaveTextContent(/generation and packaging only/i)
    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()

    // The guidance routes to the skills settings; it never installs by itself.
    await userEvent.click(screen.getByRole('button', { name: /open skills settings/i }))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/skills' })
    expect(onClose).toHaveBeenCalled()
    // No topic, no skill session: the guidance path starts nothing.
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('binds the installed skill and opens a session with the requirement draft', async () => {
    request.mockImplementation((route: string) =>
      Promise.resolve(
        route === 'skill.list_catalog'
          ? [skillEntry]
          : route === 'ai.agent.skill_session.create'
            ? { sessionId: 'session-42' }
            : undefined
      )
    )
    const onClose = vi.fn()
    render(<CreateWithAgentTab onClose={onClose} />)

    const start = await screen.findByRole('button', { name: /^start$/i })
    // No draft, no session: the button waits for a real requirement.
    expect(start).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/what should the app do/i), 'a pomodoro timer')
    await userEvent.click(start)

    // AC7's direct binding: the installed Skill's own session flow, its identity
    // at creation, the requirement handed to the prepared composer.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/app/agents',
        search: { intent: 'skill', sessionId: 'session-42', skillId: 'skill-1' }
      })
    )
    expect(request).toHaveBeenCalledWith('ai.agent.skill_session.create', { skillId: 'skill-1' })
    expect(handOffAgentDraft).toHaveBeenCalledWith(
      'session-42',
      expect.objectContaining({ text: 'a pomodoro timer', files: [], tokens: [] })
    )
    expect(onClose).toHaveBeenCalled()
  })
})
