import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PaintingEmptyScene } from '../PaintingEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('PaintingEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it.each([['PaintingEmptyScene', PaintingEmptyScene]])(
    '%s draws only translated words in Chinese',
    async (_, Scene) => {
      await getI18n().changeLanguage('zh-cn')
      const { container } = render(<Scene />)

      expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
    }
  )
})
