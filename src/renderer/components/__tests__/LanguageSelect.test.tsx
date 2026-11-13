// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { TranslateLanguage } from '@shared/data/types/translate'

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
  it('finds a language by typing its language code', () => {
    const onChange = vi.fn()
    render(<LanguageSelect value="en-us" onChange={onChange} />)

    const trigger = screen.getByRole('combobox')
    fireEvent.focus(trigger)
    fireEvent.change(trigger, { target: { value: 'zh-cn' } })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('zh-cn')
  })
})
