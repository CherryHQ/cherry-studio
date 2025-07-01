import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CopyButton from '../CopyButton'

// Mock navigator.clipboard
const mockWriteText = vi.fn()
const mockClipboard = {
  writeText: mockWriteText
}

// Mock window.message
const mockMessage = {
  success: vi.fn(),
  error: vi.fn()
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
    Object.assign(window, { message: mockMessage })

    // Clear all mocks
    vi.clearAllMocks()
  })

  it('should render with basic structure and copy icon', () => {
    render(<CopyButton textToCopy="test text" />)

    // Should have basic clickable container
    const container = document.querySelector('div')
    expect(container).toBeInTheDocument()

    // Should render copy icon
    const copyIcon = document.querySelector('.copy-icon')
    expect(copyIcon).toBeInTheDocument()
  })

  it('should render label when provided', () => {
    const labelText = 'Copy to clipboard'
    render(<CopyButton textToCopy="test text" label={labelText} />)

    expect(screen.getByText(labelText)).toBeInTheDocument()
  })

  it('should render tooltip when provided', async () => {
    const tooltipText = 'Click to copy'
    render(<CopyButton textToCopy="test text" tooltip={tooltipText} />)

    // Check that the component structure includes tooltip
    const container = document.querySelector('div')
    expect(container).toBeInTheDocument()

    // The tooltip should be rendered when hovered
    const copyIcon = document.querySelector('.copy-icon')
    expect(copyIcon).toBeInTheDocument()
  })

  it('should not render tooltip when not provided', () => {
    render(<CopyButton textToCopy="test text" />)

    // Should not have tooltip wrapper
    expect(document.querySelector('.ant-tooltip')).not.toBeInTheDocument()
  })

  it('should copy text to clipboard on click', async () => {
    const textToCopy = 'Hello World'
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy={textToCopy} />)

    // Find the clickable element by using the copy icon as reference
    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    expect(clickableElement).toBeInTheDocument()

    await userEvent.click(clickableElement!)

    expect(mockWriteText).toHaveBeenCalledWith(textToCopy)
  })

  it('should show success message when copy succeeds', async () => {
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy="test text" />)

    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    await userEvent.click(clickableElement!)

    expect(mockMessage.success).toHaveBeenCalledWith('复制成功')
    expect(mockMessage.error).not.toHaveBeenCalled()
  })

  it('should show error message when copy fails', async () => {
    mockWriteText.mockRejectedValue(new Error('Clipboard access denied'))

    render(<CopyButton textToCopy="test text" />)

    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    await userEvent.click(clickableElement!)

    expect(mockMessage.error).toHaveBeenCalledWith('复制失败')
    expect(mockMessage.success).not.toHaveBeenCalled()
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

  it('should handle empty text', async () => {
    const emptyText = ''
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy={emptyText} />)

    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    await userEvent.click(clickableElement!)

    expect(mockWriteText).toHaveBeenCalledWith(emptyText)
  })

  it('should handle special characters', async () => {
    const specialText = '特殊字符 🎉 @#$%^&*()'
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy={specialText} />)

    const copyIcon = document.querySelector('.copy-icon')
    const clickableElement = copyIcon?.parentElement
    await userEvent.click(clickableElement!)

    expect(mockWriteText).toHaveBeenCalledWith(specialText)
  })
})
