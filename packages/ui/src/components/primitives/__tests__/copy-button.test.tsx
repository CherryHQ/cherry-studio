// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CopyButton from '../copy-button'

const writeText = vi.fn()

describe('CopyButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('shows a check icon after copying text', async () => {
    writeText.mockResolvedValue(undefined)

    render(<CopyButton textToCopy="API key" aria-label="Copy API key" />)

    const button = screen.getByRole('button', { name: 'Copy API key' })
    expect(button.className).toContain('hover:text-foreground')
    expect(button.querySelector('.lucide-copy')).not.toBeNull()

    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith('API key')
    await waitFor(() => expect(button.querySelector('.lucide-check')).not.toBeNull())
  })

  it('keeps the copy icon and reports clipboard errors', async () => {
    const error = new Error('Clipboard access denied')
    const onCopyError = vi.fn()
    writeText.mockRejectedValue(error)

    render(<CopyButton textToCopy="API key" aria-label="Copy API key" onCopyError={onCopyError} />)
    const button = screen.getByRole('button', { name: 'Copy API key' })

    fireEvent.click(button)

    await waitFor(() => expect(onCopyError).toHaveBeenCalledWith(error))
    expect(button.querySelector('.lucide-copy')).not.toBeNull()
    expect(button.querySelector('.lucide-check')).toBeNull()
  })
})
