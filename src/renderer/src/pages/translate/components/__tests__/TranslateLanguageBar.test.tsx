import { parsePersistedLangCode, type TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateLanguageBar from '../TranslateLanguageBar'

const mockUseLanguages = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => mockUseLanguages()
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
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

  return {
    ...actual,
    Popover,
    PopoverTrigger,
    PopoverContent,
    Button: ({ children, onClick, disabled, ...rest }: React.ComponentProps<'button'>) => (
      <button type="button" onClick={onClick} disabled={disabled} {...rest}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

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

type BarProps = React.ComponentProps<typeof TranslateLanguageBar>

const baseProps = (): BarProps => ({
  sourceLanguage: 'auto',
  onSourceChange: vi.fn(),
  targetLanguage: english.langCode,
  onTargetChange: vi.fn(),
  detectedLanguage: null,
  isBidirectional: false,
  bidirectionalPair: [english.langCode, chinese.langCode],
  couldExchange: true,
  onExchange: vi.fn()
})

describe('TranslateLanguageBar', () => {
  beforeEach(() => {
    mockUseLanguages.mockReset()
    mockUseLanguages.mockReturnValue({
      languages: [english, chinese, japanese],
      getLanguage: (code: string) => [english, chinese, japanese].find((l) => l.langCode === code),
      getLabel: (language: TranslateLanguage | TranslateLangCode | null, withEmoji = true) => {
        if (typeof language === 'string') return language === 'unknown' ? 'Unknown' : language
        if (!language) return 'Unknown'
        return withEmoji ? `${language.emoji} ${language.value}` : language.value
      }
    })
  })

  it('renders source placeholder and target language labels', () => {
    render(<TranslateLanguageBar {...baseProps()} />)
    expect(screen.getByText('translate.source_language')).toBeInTheDocument()
    expect(screen.getByText('translate.target_language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('opens source dropdown and calls onSourceChange on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.source_language'))

    const options = screen.getAllByText('Chinese')
    fireEvent.click(options[0])

    expect(props.onSourceChange).toHaveBeenCalledWith(chinese.langCode)
  })

  it('exposes source dropdown options with listbox roles and selected state', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    fireEvent.click(screen.getByText('translate.source_language'))

    const listbox = screen.getByRole('listbox')
    const autoOption = within(listbox).getByRole('option', { name: /translate\.detected\.language/ })
    expect(autoOption).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps selected option padding classes mutually exclusive', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    fireEvent.click(screen.getByText('translate.source_language'))

    const selectedOption = screen.getByRole('option', { name: /translate\.detected\.language/ })
    const optionContent = selectedOption.querySelector('span')

    expect(optionContent?.className).toContain('px-2')
    expect(optionContent?.className).not.toContain('px-3')
  })

  it('selects auto option', () => {
    const props = baseProps()
    props.sourceLanguage = english.langCode
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.source_language'))
    fireEvent.click(screen.getByText('translate.detected.language'))

    expect(props.onSourceChange).toHaveBeenCalledWith('auto')
  })

  it('invokes onExchange when swap button is clicked', () => {
    const props = baseProps()
    const { container } = render(<TranslateLanguageBar {...props} />)
    // swap button is the only ArrowLeftRight-containing button outside the language popovers
    const swapButton = container.querySelector('button[disabled="false"], button:not([disabled])')
    // Find by process of elimination: the swap button contains no text
    const allButtons = Array.from(container.querySelectorAll('button'))
    const emptyLabelButton = allButtons.find((b) => !b.textContent?.trim())
    expect(emptyLabelButton).toBeTruthy()
    fireEvent.click(emptyLabelButton!)
    expect(props.onExchange).toHaveBeenCalled()
    expect(swapButton).toBeTruthy()
  })

  it('disables swap button when couldExchange is false', () => {
    const props = baseProps()
    props.couldExchange = false
    const { container } = render(<TranslateLanguageBar {...props} />)
    const allButtons = Array.from(container.querySelectorAll('button'))
    const swapButton = allButtons.find((b) => !b.textContent?.trim())
    expect(swapButton).toHaveAttribute('disabled')
  })

  it('renders bidirectional pair display and disables source dropdown', () => {
    const props = baseProps()
    props.isBidirectional = true
    const { container } = render(<TranslateLanguageBar {...props} />)

    // The A ⇆ B text is present
    expect(container.textContent).toContain('English ⇆ Chinese')

    // Source trigger button is disabled
    const sourceButton = screen.getByText('translate.source_language').closest('button')
    expect(sourceButton).toHaveAttribute('disabled')
  })

  it('adds visible focus rings to language trigger buttons', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    const sourceButton = screen.getByText('translate.source_language').closest('button')
    const targetButton = screen.getByText('translate.target_language').closest('button')

    expect(sourceButton?.className).toContain('focus-visible:ring-2')
    expect(targetButton?.className).toContain('focus-visible:ring-2')
  })

  it('opens target dropdown and calls onTargetChange on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.target_language'))

    const list = screen.getAllByText('Japanese')
    fireEvent.click(list[0])

    expect(props.onTargetChange).toHaveBeenCalledWith(japanese.langCode)
  })

  it('shows detected language hint when sourceLanguage is auto and detectedLanguage is set', () => {
    const props = baseProps()
    props.detectedLanguage = chinese.langCode
    render(<TranslateLanguageBar {...props} />)

    // Inside the source trigger the label contains "(Chinese)"
    const sourceTrigger = screen.getByText('translate.source_language').closest('button')
    expect(within(sourceTrigger!).getByText(/translate\.detected\.language \(Chinese\)/)).toBeInTheDocument()
  })
})
