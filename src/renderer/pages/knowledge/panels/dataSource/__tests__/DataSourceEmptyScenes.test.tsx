import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataSourceEmptyScene, ChunkEmptyScene } from '../DataSourceEmptyScenes'

vi.unmock('@cherrystudio/ui')

describe('DataSourceEmptyScenes', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it.each([
    ['DataSourceEmptyScene', DataSourceEmptyScene],
    ['ChunkEmptyScene', ChunkEmptyScene]
  ])('%s draws only translated words in Chinese', async (_, Scene) => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<Scene />)

    expect(container.textContent?.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
