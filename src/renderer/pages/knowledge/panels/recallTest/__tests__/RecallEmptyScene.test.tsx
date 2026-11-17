import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecallEmptyScene } from '../RecallEmptyScene'

vi.unmock('@cherrystudio/ui')

describe('RecallEmptyScene', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it.each([['RecallEmptyScene', RecallEmptyScene]])('%s draws only translated words in Chinese', async (_, Scene) => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<Scene />)

    // "Query" is a term the Chinese locale keeps in English ("输入测试 Query...").
    const text = container.textContent?.replaceAll('Query', '') ?? ''
    expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
