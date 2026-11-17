import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillMarketplaceEmptyScene, SystemSkillEmptyScene } from '../SkillEmptyScenes'

vi.unmock('@cherrystudio/ui')

describe('SkillEmptyScenes', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it.each([
    ['SkillMarketplaceEmptyScene', SkillMarketplaceEmptyScene],
    ['SystemSkillEmptyScene', SystemSkillEmptyScene]
  ])('%s draws only translated words in Chinese', async (_, Scene) => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<Scene />)

    // "Skill" is a product term the Chinese locale keeps in English (e.g. "系统 Skill").
    const text = container.textContent?.replaceAll('Skill', '') ?? ''
    expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
