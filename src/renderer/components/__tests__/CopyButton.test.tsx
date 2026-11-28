import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import CopyButton from '../CopyButton'

// Mock navigator.clipboard
const mockWriteText = vi.fn()
const mockClipboard = {
  writeText: mockWriteText
}

// Mock useTranslation
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'message.copy.success': '复制成功',
        'message.copy.failed': '复制失败'
      }
      return translations[key] || key
    }
  })
}))

describe('CopyButton', () => {
  beforeEach(() => {
    // Setup mocks
    Object.assign(navigator, { clipboard: mockClipboard })

    // Clear all mocks
    vi.clearAllMocks()
  })

  it('should copy text to the clipboard and show a success message', async () => {
    const textToCopy = 'Hello World'
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy={textToCopy} />)

    await userEvent.click(screen.getByRole('button'))

    expect(mockWriteText).toHaveBeenCalledWith(textToCopy)
    expect(toast.success).toHaveBeenCalledWith('复制成功')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should forward native button props for composition', () => {
    render(
      <CopyButton
        textToCopy="test text"
        className="size-6"
        aria-label="Copy test text"
        successFeedback="icon"
        disabled
      />
    )

    const button = screen.getByRole('button', { name: 'Copy test text' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toBeDisabled()
  })

  it('should show error message when copy fails', async () => {
    mockWriteText.mockRejectedValue(new Error('Clipboard access denied'))

    render(<CopyButton textToCopy="test text" />)

    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    await userEvent.click(clickableElement!)

    expect(toast.error).toHaveBeenCalledWith('复制失败')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
