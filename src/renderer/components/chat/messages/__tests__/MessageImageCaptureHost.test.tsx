import type { MessageListProviderValue } from '@renderer/components/chat/messages/types'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <button type="button">Hidden action</button>
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

const { default: MessageImageCaptureHost } = await import('../MessageImageCaptureHost')

describe('MessageImageCaptureHost', () => {
  it('removes the offscreen capture tree from accessibility and keyboard focus', () => {
    render(
      <MessageImageCaptureHost
        captureHostAttribute="data-test-capture-host"
        messageList={{} as MessageListProviderValue}
        ready
        testId="message-image-capture-host"
      />
    )

    const host = screen.getByTestId('message-image-capture-host')
    expect(host).toHaveAttribute('aria-hidden', 'true')
    expect(host).toHaveAttribute('inert')
    expect(host).toHaveAttribute('data-test-capture-host')
  })
})
