// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import logosMeta, { LogoMark } from '../../../../stories/components/icons/logos.stories'
import type { CompoundIcon, CompoundIconProps } from '../types'

const TestIcon = ((props: CompoundIconProps) => <svg {...props} />) as CompoundIcon
TestIcon.Avatar = () => null
TestIcon.colorPrimary = '#000000'

afterEach(() => {
  cleanup()
})

describe('LogoMark', () => {
  it('is excluded from Storybook stories', () => {
    expect(logosMeta.excludeStories).toContain('LogoMark')
  })

  it('keeps the frame size while leaving GPT tiles full-bleed', () => {
    const { container } = render(
      <>
        <LogoMark Component={TestIcon} fontSize={48} kind="provider" name="OpenAi" />
        <LogoMark Component={TestIcon} fontSize={48} kind="model" name="Claude" />
        <LogoMark Component={TestIcon} fontSize={48} kind="model" name="Gpt55" />
        <LogoMark Component={TestIcon} fontSize={48} kind="model" name="Aionlabs" />
      </>
    )

    const providerFrame = container.querySelector('[data-logo-name="OpenAi"]')
    const modelFrame = container.querySelector('[data-logo-name="Claude"]')
    const gptFrame = container.querySelector('[data-logo-name="Gpt55"]')
    const aionlabsFrame = container.querySelector('[data-logo-name="Aionlabs"]')
    const providerIcon = providerFrame?.querySelector('svg')
    const modelIcon = modelFrame?.querySelector('svg')
    const gptIcon = gptFrame?.querySelector('svg')
    const aionlabsIcon = aionlabsFrame?.querySelector('svg')

    expect(providerFrame).toHaveStyle({ height: '48px', width: '48px' })
    expect(modelFrame).toHaveStyle({ height: '48px', width: '48px' })
    expect(gptFrame).toHaveStyle({ height: '48px', width: '48px' })
    expect(aionlabsFrame).toHaveStyle({ height: '48px', width: '48px' })
    expect(providerIcon).toHaveStyle({ fontSize: '48px' })
    expect(modelIcon).toHaveStyle({ fontSize: '32px' })
    expect(gptIcon).toHaveStyle({ fontSize: '48px' })
    expect(aionlabsIcon).toHaveStyle({ fontSize: '48px' })
  })
})
