import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import i18n from '@renderer/i18n/resolver'

import MessageCompactionStatus from '../MessageCompactionStatus'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const KEY = 'message.context.compacting.message-1'

beforeEach(async () => {
  await i18n.changeLanguage('en-us')
  cacheService.deleteShared(KEY)
})

describe('MessageCompactionStatus', () => {
  it('announces compaction while it is running and removes the notice when it settles', async () => {
    render(<MessageCompactionStatus messageId="message-1" fallback={<span>Preparing response</span>} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      cacheService.setShared(KEY, true)
    })
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.compaction.compacting'))
    expect(screen.queryByText('Preparing response')).not.toBeInTheDocument()

    await act(async () => {
      cacheService.deleteShared(KEY)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Preparing response')).toBeInTheDocument()
  })

  it('restores in-flight progress when returning to its message without showing it on another message', () => {
    cacheService.setShared(KEY, true)
    const { rerender } = render(<MessageCompactionStatus messageId="message-2" fallback={null} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<MessageCompactionStatus messageId="message-1" fallback={<span>Preparing response</span>} />)
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.compaction.compacting'))

    rerender(<MessageCompactionStatus messageId="message-2" fallback={null} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
