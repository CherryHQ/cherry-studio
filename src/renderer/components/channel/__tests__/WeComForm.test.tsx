import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ChannelData, ChannelUpdates } from '../channelTypes'
import { WeComForm } from '../WeComForm'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const channel: ChannelData = {
  id: 'wecom',
  name: 'WeCom',
  type: 'wecom',
  isActive: false,
  config: { bot_id: 'old', secret: 'original', allowed_chat_ids: [], allowed_user_ids: [] }
}

it('submits independent field patches while earlier saves have not refreshed the channel', () => {
  const changes: ChannelUpdates[] = []
  render(<WeComForm channel={channel} onConfigChange={(updates) => changes.push(updates)} />)
  for (const [key, value] of [
    ['botId', ' new '],
    ['secret', ' secret '],
    ['chatIds', ' dm:alice, dm:alice ']
  ]) {
    const input = screen.getByLabelText(`agent.channels.wecom.${key}`)
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
  }
  expect(changes).toEqual([
    { configPatch: { bot_id: 'new' } },
    { configPatch: { secret: ' secret ' } },
    { configPatch: { allowed_chat_ids: ['dm:alice'] } }
  ])
})
