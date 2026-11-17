import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubagentFlowEmptyScene } from '../SubagentFlowEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('SubagentFlowEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it('draws only translated words in Chinese', async () => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<SubagentFlowEmptyScene />)

    expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
