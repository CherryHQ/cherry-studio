import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeEmptyScene } from '../KnowledgeEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('KnowledgeEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('draws only translated words in Chinese', async () => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<KnowledgeEmptyScene />)

    // Format names and URL schemes are the only Latin words a scene may draw.
    const text = container.textContent?.replace(/PDF|DOCX|MD|URL|\.pdf/g, '') ?? ''
    expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
