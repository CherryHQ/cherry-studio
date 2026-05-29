import { parsePersistedLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LanguagePicker from '../LanguagePicker'

const createLanguage = (langCode: string, value: string, emoji: string): TranslateLanguage => ({
  value,
  langCode: parsePersistedLangCode(langCode),
  emoji,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const english = createLanguage('en-us', 'English', '🇬🇧')
const chinese = createLanguage('zh-cn', 'Chinese', '🇨🇳')
const japanese = createLanguage('ja-jp', 'Japanese', '🇯🇵')
const allLanguages: TranslateLanguage[] = [english, chinese, japanese]

const mockUseLanguages = vi.fn()

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => mockUseLanguages()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { createContext, use, cloneElement, isValidElement } = await import('react')
  type Ctx = { open: boolean; onOpenChange: (next: boolean) => void }
  const PopoverCtx = createContext<Ctx>({ open: false, onOpenChange: () => {} })

  const Popover = ({
    children,
    open,
    onOpenChange
  }: {
    children?: React.ReactNode
    open?: boolean
    onOpenChange?: (next: boolean) => void
  }) => <PopoverCtx value={{ open: open ?? false, onOpenChange: onOpenChange ?? (() => {}) }}>{children}</PopoverCtx>

  const PopoverTrigger = ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => {
    const { open, onOpenChange } = use(PopoverCtx)
    const toggle = () => onOpenChange(!open)
    if (asChild && isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
      return cloneElement(child, {
        onClick: (e: React.MouseEvent) => {
          child.props.onClick?.(e)
          toggle()
        }
      })
    }
    return (
      <button type="button" onClick={toggle}>
        {children}
      </button>
    )
  }

  const PopoverContent = ({ children }: { children?: React.ReactNode }) => {
    const { open } = use(PopoverCtx)
    return open ? <div data-testid="popover-content">{children}</div> : null
  }

  return { ...actual, Popover, PopoverTrigger, PopoverContent }
})

describe('LanguagePicker', () => {
  beforeEach(() => {
    mockUseLanguages.mockReset()
    mockUseLanguages.mockReturnValue({
      languages: allLanguages,
      getLanguage: (code: string) => allLanguages.find((l) => l.langCode === code),
      getLabel: (language: TranslateLanguage | TranslateLangCode | null, withEmoji = true) => {
        if (typeof language === 'string') return language === 'unknown' ? 'Unknown' : language
        if (!language) return 'Unknown'
        return withEmoji ? `${language.emoji} ${language.value}` : language.value
      }
    })
  })

  it('renders selected language emoji and label in trigger', () => {
    render(<LanguagePicker value="en-us" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { expanded: false })
    expect(trigger.textContent).toContain('English')
    expect(trigger.textContent).toContain('🇬🇧')
  })

  it('opens listbox on trigger click and excludes UNKNOWN', () => {
    render(<LanguagePicker value="en-us" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(listbox).toBeInTheDocument()
    expect(options).toHaveLength(3)
    expect(listbox.textContent).not.toContain('Unknown')
  })

  it('calls onChange with selected langCode and closes dropdown', () => {
    const onChange = vi.fn()
    render(<LanguagePicker value="en-us" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    const chineseOption = screen.getAllByRole('option').find((o) => o.textContent?.includes('Chinese'))
    fireEvent.click(chineseOption!)

    expect(onChange).toHaveBeenCalledWith('zh-cn')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks currently selected option with aria-selected', () => {
    render(<LanguagePicker value="zh-cn" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))

    const options = screen.getAllByRole('option')
    const selected = options.find((o) => o.getAttribute('aria-selected') === 'true')
    const unselected = options.filter((o) => o.getAttribute('aria-selected') === 'false')

    expect(selected?.textContent).toContain('Chinese')
    expect(unselected).toHaveLength(2)
  })

  it('disables trigger when disabled prop is set', () => {
    render(<LanguagePicker value="en-us" onChange={vi.fn()} disabled />)
    expect(screen.getByRole('button', { expanded: false })).toBeDisabled()
  })

  it('falls back to UNKNOWN display when value is not in the language list', () => {
    render(<LanguagePicker value={'xx-xx' as never} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { expanded: false })
    expect(trigger.textContent).toContain('Unknown')
    expect(trigger.textContent).toContain('🏳️')
  })
})
