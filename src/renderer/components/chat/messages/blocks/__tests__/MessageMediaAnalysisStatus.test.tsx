import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import i18n from '@renderer/i18n/resolver'

import MessageMediaAnalysisStatus from '../MessageMediaAnalysisStatus'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const KEY = 'message.media_analysis.message-1'

beforeEach(async () => {
  await i18n.changeLanguage('en-us')
  cacheService.deleteShared(KEY)
})

describe('MessageMediaAnalysisStatus', () => {
  it('shows the analysis stage until preparation ends, then the fallback', async () => {
    render(<MessageMediaAnalysisStatus messageId="message-1" fallback={<span>Preparing response</span>} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => {
      cacheService.setShared(KEY, { stage: 'transcribing' })
    })
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.media_analysis.transcribing'))

    await act(async () => {
      cacheService.setShared(KEY, { stage: 'reading_frames', done: 3, total: 8 })
    })
    expect(screen.getByRole('status')).toHaveTextContent('3/8')

    await act(async () => {
      cacheService.deleteShared(KEY)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Preparing response')).toBeInTheDocument()
  })

  it('leaves out the frame count before the first batch of frames is described', () => {
    cacheService.setShared(KEY, { stage: 'describing_frames', done: 0, total: 2 })

    render(<MessageMediaAnalysisStatus messageId="message-1" fallback={null} />)

    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('chat.media_analysis.describing_frames_started'))
    expect(screen.getByRole('status')).not.toHaveTextContent('0/2')
  })
})
