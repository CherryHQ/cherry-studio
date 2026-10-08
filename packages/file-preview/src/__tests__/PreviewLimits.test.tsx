import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Preview } from '../Preview'
import type { PreviewDocument } from '../source'

vi.unmock('@cherrystudio/ui')

afterEach(cleanup)

describe('Office preview size limits', () => {
  it.each([
    ['docx', 25],
    ['pptx', 25],
    ['xlsx', 20]
  ] as const)('lets the host open an oversized %s without reading its contents', async (extension, limitMiB) => {
    const user = userEvent.setup()
    const document: PreviewDocument = {
      size: 30 * 1024 * 1024,
      revision: 'v1',
      readRange: vi.fn().mockRejectedValue(new Error('Oversized files must not be read')),
      close: vi.fn().mockResolvedValue(undefined)
    }
    const onError = vi.fn()
    const onRequestOpen = vi.fn()
    render(
      <Preview
        source={{ id: 'oversize', name: `report.${extension}`, open: async () => document }}
        onError={onError}
        onRequestOpen={onRequestOpen}
        locale="en-us"
      />
    )

    expect(await screen.findByRole('heading', { name: 'File too large to preview' })).toBeInTheDocument()
    expect(screen.getByText(`File size 30.0 MB exceeds the ${limitMiB}.0 MB preview limit.`)).toBeInTheDocument()
    expect(document.readRange).not.toHaveBeenCalled()
    expect(document.close).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'too_large' }))
    expect(onRequestOpen).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open with default app' }))

    expect(onRequestOpen).toHaveBeenCalledWith('too_large')
  })
})
