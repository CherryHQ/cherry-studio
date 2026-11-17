import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TopicMessageFlowEmptyScene } from '../TopicMessageFlowEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('TopicMessageFlowEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('draws only translated words in Chinese', async () => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<TopicMessageFlowEmptyScene />)

    expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
