import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearTimeoutTimer: vi.fn(),
  setTimeoutTimer: vi.fn(),
  useSelector: vi.fn(),
  useSettings: vi.fn()
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mocks.useSettings()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    clearTimeoutTimer: mocks.clearTimeoutTimer,
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('react-redux', () => ({
  useSelector: mocks.useSelector
}))

vi.mock('../ChatFlowHistory', () => ({ default: () => null }))

import ChatNavigation from '../ChatNavigation'

describe('ChatNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSelector.mockReturnValue(undefined)
    mocks.useSettings.mockReturnValue({ topicPosition: 'left', showTopics: true })
  })

  it('scrolls the conversation to its top when the back-to-top button is clicked', () => {
    const scrollTo = vi.fn()
    const messages = document.createElement('div')
    messages.id = 'messages'
    messages.scrollTo = scrollTo
    document.body.appendChild(messages)

    try {
      render(<ChatNavigation containerId="messages" />)

      fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.top' }))

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    } finally {
      messages.remove()
    }
  })
})
