import { render, screen } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilePreviewEmptyScene } from '../FilePreviewEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('FilePreviewEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('draws only translated words in Chinese', async () => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<FilePreviewEmptyScene kind="unsupported" />)

    expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })

  it('offers the open action only for unsupported files', async () => {
    await getI18n().changeLanguage('en-us')
    const { rerender } = render(<FilePreviewEmptyScene kind="unsupported" />)
    expect(screen.getByText('Open')).toBeInTheDocument()

    rerender(<FilePreviewEmptyScene kind="directory" />)
    expect(screen.queryByText('Open')).toBeNull()
  })
})
