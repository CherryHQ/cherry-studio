// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return await importOriginal<typeof CherryStudioUi>()
})

const languageState = vi.hoisted(() => {
  const languages = [
    { langCode: 'zh-cn', value: 'Chinese', emoji: '🇨🇳' },
    { langCode: 'en-us', value: 'English', emoji: '🇺🇸' }
  ] as TranslateLanguage[]

  return { languages }
})

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    languages: languageState.languages,
    getLabel: (language: TranslateLanguage) => language.value
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import LanguageSelect from '../LanguageSelect'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LanguageSelect', () => {
  it('uses the trigger width without retaining the popover default width', async () => {
    render(<LanguageSelect value="zh-cn" />)

    fireEvent.focus(screen.getByRole('combobox'))

    const popoverContent = await waitFor(() => {
      const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
      expect(content).toBeInTheDocument()
      return content!
    })

    expect(popoverContent).toHaveClass('w-[var(--radix-popover-trigger-width)]')
    expect(popoverContent).not.toHaveClass('w-72')
  })
})
