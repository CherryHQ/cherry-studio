import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import CopyButton from '../CopyButton'

// Mock navigator.clipboard
const mockWriteText = vi.fn()

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
  let user: ReturnType<typeof userEvent.setup>
  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(mockWriteText)
  })

  it('should copy text to the clipboard and show a success message', async () => {
    const textToCopy = 'Hello World'
    mockWriteText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy={textToCopy} />)

    await user.click(screen.getByRole('button'))

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

    await user.click(screen.getByRole('button'))

    expect(toast.error).toHaveBeenCalledWith('复制失败')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reads content on click and reports success only after the clipboard write completes', async () => {
    const content = Promise.withResolvers<string>()
    const written = Promise.withResolvers<void>()
    mockWriteText.mockReturnValue(written.promise)
    render(<CopyButton textToCopy={() => content.promise} />)

    expect(mockWriteText).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button'))
    expect(mockWriteText).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => content.resolve('Fresh command output'))
    expect(mockWriteText).toHaveBeenCalledWith('Fresh command output')
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => written.resolve())
    expect(toast.success).toHaveBeenCalledWith('复制成功')
  })

  it('reports content-read failure without copying or reporting success', async () => {
    render(
      <CopyButton
        textToCopy={async () => {
          throw new Error('Output unavailable')
        }}
      />
    )

    await user.click(screen.getByRole('button'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('复制失败'))
    expect(mockWriteText).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
