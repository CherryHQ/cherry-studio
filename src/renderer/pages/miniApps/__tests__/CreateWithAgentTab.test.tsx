import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import CreateWithAgentTab from '../CreateWithAgentTab'

const { request, reuseOrCreateTopic, writeChatDraftCache, navigate } = vi.hoisted(() => ({
  request: vi.fn(),
  reuseOrCreateTopic: vi.fn(),
  writeChatDraftCache: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/hooks/resourceViewSources', () => ({
  useRawAssistantTopicsSource: () => ({ reuseOrCreateTopic })
}))
vi.mock('@renderer/components/composer/variants/chat/chatDraftCache', () => ({ writeChatDraftCache }))
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
  reuseOrCreateTopic.mockReset()
  writeChatDraftCache.mockReset()
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
    expect(reuseOrCreateTopic).not.toHaveBeenCalled()
  })

  it('binds the installed skill and opens a session with the requirement draft', async () => {
    request.mockResolvedValueOnce([skillEntry])
    reuseOrCreateTopic.mockResolvedValueOnce({ topic: { id: 'topic-42' }, created: true })
    const onClose = vi.fn()
    render(<CreateWithAgentTab onClose={onClose} />)

    const start = await screen.findByRole('button', { name: /^start$/i })
    // No draft, no session: the button waits for a real requirement.
    expect(start).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/what should the app do/i), 'a pomodoro timer')
    await userEvent.click(start)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/app/chat', search: { topicId: 'topic-42' } }))
    expect(reuseOrCreateTopic).toHaveBeenCalledWith(null)
    expect(writeChatDraftCache).toHaveBeenCalledWith(
      'topic-42',
      expect.objectContaining({ text: 'a pomodoro timer', files: [], tokens: [] })
    )
    expect(onClose).toHaveBeenCalled()
  })
})
