import { toast } from '@renderer/services/toast'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('should render label when provided', () => {
    const labelText = 'Copy to clipboard'
    render(<CopyButton textToCopy="test text" label={labelText} />)

    expect(screen.getByText(labelText)).toBeInTheDocument()
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

  it('should show a check icon without a success toast in icon feedback mode', async () => {
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy="test text" successFeedback="icon" />)

    await userEvent.click(screen.getByRole('button'))

    expect(document.querySelector('.lucide-check')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
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
    expect(button).toHaveClass('size-6')
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

  it('should apply custom size to icon and label', () => {
    const customSize = 20
    const labelText = 'Copy'

    render(<CopyButton textToCopy="test text" size={customSize} label={labelText} />)

    // Should apply custom size to icon
    const copyIcon = document.querySelector('.copy-icon')
    expect(copyIcon).toHaveAttribute('width', customSize.toString())
    expect(copyIcon).toHaveAttribute('height', customSize.toString())

    // Should apply custom size to label
    const label = screen.getByText(labelText)
    expect(label).toHaveStyle({ fontSize: `${customSize}px` })
  })
})
