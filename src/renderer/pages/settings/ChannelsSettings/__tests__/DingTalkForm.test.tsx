import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ChannelData } from '../channelTypes'
import { DingTalkForm } from '../DingTalkForm'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Form() {
  const [channel, setChannel] = useState<ChannelData>({
    id: 'channel',
    name: 'DingTalk',
    type: 'dingtalk',
    isActive: false,
    config: { client_id: '', client_secret: '', robot_code: '', allowed_chat_ids: [], allowed_user_ids: [] }
  })
  return (
    <>
      <DingTalkForm
        channel={channel}
        onConfigChange={(updates) =>
          setChannel((current) => ({ ...current, config: { ...current.config, ...updates.configPatch } }))
        }
      />
      <output data-testid="saved-config">{JSON.stringify(channel.config)}</output>
    </>
  )
}

describe('DingTalk setup', () => {
  it('saves normalized IDs while preserving secret bytes and hiding the secret input', () => {
    render(<Form />)
    const edit = (key: string, value: string) => {
      const input = screen.getByLabelText(`agent.channels.dingtalk.${key}`)
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
    }
    edit('clientId', ' app ')
    edit('clientSecret', ' secret ')
    edit('robotCode', ' robot ')
    edit('chatIds', ' dm:alice, group:team, dm:alice, ')
    edit('userIds', ' alice, alice ')
    expect(screen.getByLabelText('agent.channels.dingtalk.clientSecret')).toHaveAttribute('type', 'password')
    expect(JSON.parse(screen.getByTestId('saved-config').textContent)).toEqual({
      client_id: 'app',
      client_secret: ' secret ',
      robot_code: 'robot',
      allowed_chat_ids: ['dm:alice', 'group:team'],
      allowed_user_ids: ['alice']
    })
  })
})
