import type { CitationMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationBlock from '../CitationBlock'

let activeSearches: Record<string, { phase: string; countAfter?: number }> = {}

vi.mock('@data/hooks/useCache', () => ({
  useSharedCache: () => [activeSearches]
}))

vi.mock('@renderer/components/Spinner', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div data-testid="spinner">{text}</div>
}))

vi.mock('../../CitationsList', () => ({
  __esModule: true,
  default: () => <div data-testid="citations-list" />
}))

vi.mock('@renderer/store/messageBlock', () => ({
  __esModule: true,
  default: (state = {}) => state,
  selectFormattedCitationsByBlockId: () => []
}))

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      messages: {
        entities: {
          'message-1': { askId: 'request-1' }
        }
      }
    })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'message.websearch.partial_failure' ? `${options?.count} partial results` : key
  })
}))

describe('CitationBlock', () => {
  beforeEach(() => {
    activeSearches = {}
  })

  it('shows partial failure status while citation block is processing', () => {
    activeSearches = {
      'request-1': {
        phase: 'partial_failure',
        countAfter: 2
      }
    }

    const block: CitationMessageBlock = {
      id: 'citation-1',
      messageId: 'message-1',
      type: MessageBlockType.CITATION,
      status: MessageBlockStatus.PROCESSING,
      createdAt: '2026-04-30T00:00:00.000Z'
    }

    render(<CitationBlock block={block} />)

    expect(screen.getByTestId('spinner')).toHaveTextContent('2 partial results')
  })
})
