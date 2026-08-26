import '@testing-library/jest-dom/vitest'

import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { CodeBlockWrapLinesContext } from '@renderer/components/CodeBlockView/wrapLinesContext'
import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import { use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ActionResultContent from '../ActionResultContent'

vi.mock('@renderer/components/chat/messages/hooks/useMessageListRenderConfig', () => ({
  useMessageListRenderConfig: () => ({ renderConfig: {} })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({})
}))

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: function MockMessageContent() {
    const wrapLines = use(CodeBlockWrapLinesContext)
    return <div data-testid="selection-result-markdown" data-wrap-lines={String(wrapLines)} />
  }
}))

const message = {
  id: 'selection-translation-result',
  role: 'assistant'
} as MessageListItem

const partsByMessageId: Record<string, CherryMessagePart[]> = {
  'selection-translation-result': [
    {
      type: 'text',
      text: "```js\nconst token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n```"
    }
  ]
}

describe('ActionResultContent', () => {
  it('keeps the result panel shrinkable and forces code-block wrap', () => {
    // Regression: long translation code was clipped because wrap followed the
    // chat preference (default off) and the flex panel could not shrink.
    const { container } = render(<ActionResultContent message={message} partsByMessageId={partsByMessageId} />)
    const panel = container.firstElementChild

    expect(panel).toHaveClass('min-w-0', 'max-w-full')
    expect(screen.getByTestId('selection-result-markdown')).toHaveAttribute('data-wrap-lines', 'true')
  })
})
