import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ChannelData } from '../channelTypes'
import { TelegramForm } from '../ChannelForms'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({ agents: [{ id: 'agent-research', name: 'Research' }] })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: {}, useIpcOn: vi.fn() }))
vi.mock('@renderer/components/PermissionModeOption', () => ({
  FullAccessConfirmDialog: () => null,
  PermissionModeSelectItem: () => null
}))

function Form() {
  const [channel, setChannel] = useState<ChannelData>({
    id: 'channel',
    name: 'Telegram',
    type: 'telegram',
    isActive: false,
    config: { bot_token: '', allowed_chat_ids: [] }
  })
  return (
    <>
      <TelegramForm
        channel={channel}
        onConfigChange={(updates) =>
          setChannel((current) => ({
            ...current,
            config: updates.config ?? { ...current.config, ...updates.configPatch }
          }))
        }
      />
      <output data-testid="saved-config">{JSON.stringify(channel.config)}</output>
    </>
  )
}

const savedTopicAgents = () => JSON.parse(screen.getByTestId('saved-config').textContent ?? '{}').topic_agents ?? {}

describe('Telegram forum topic bindings', () => {
  it('saves a chatId:topicId key bound to the chosen agent', async () => {
    const user = userEvent.setup()
    render(<Form />)

    await user.type(screen.getByLabelText('agent.channels.telegram.topicAgents.topic'), '-1001234567890:7')
    await user.click(screen.getByLabelText('agent.channels.telegram.topicAgents.agent'))
    await user.click(await screen.findByRole('option', { name: 'Research' }))

    expect(savedTopicAgents()).toEqual({ '-1001234567890:7': 'agent-research' })
  })

  it('does not save a topic key that is not chatId:topicId', async () => {
    const user = userEvent.setup()
    render(<Form />)

    await user.type(screen.getByLabelText('agent.channels.telegram.topicAgents.topic'), '7')
    await user.click(screen.getByLabelText('agent.channels.telegram.topicAgents.agent'))
    await user.click(await screen.findByRole('option', { name: 'Research' }))

    expect(savedTopicAgents()).toEqual({})
  })
})
