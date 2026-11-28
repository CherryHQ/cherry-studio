import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilesEmptyScene } from '../FilesEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('FilesEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('draws only translated words in Chinese', async () => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<FilesEmptyScene />)

    // Format names and URL schemes are the only Latin words a scene may draw.
    expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
