import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateLanguageBar from '../TranslateLanguageBar'
import { chinese, createLanguage, createLanguagesHookResult, english, japanese } from './testUtils'

const mockUseLanguages = vi.fn()
const mockT = vi.fn((key: string) => key)
const sourceLanguageButtonName = /translate\.source_language/
const targetLanguageButtonName = /translate\.target_language/

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT })
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => mockUseLanguages()
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { createContext, use, cloneElement, isValidElement } = await import('react')
  type Ctx = { open: boolean; onOpenChange: (next: boolean) => void }
  const PopoverContext = createContext<Ctx>({ open: false, onOpenChange: () => {} })

  const Popover = ({
    children,
    open,
    onOpenChange
  }: {
    children?: React.ReactNode
    open?: boolean
    onOpenChange?: (next: boolean) => void
  }) => (
    <PopoverContext value={{ open: open ?? false, onOpenChange: onOpenChange ?? (() => {}) }}>
      {children}
    </PopoverContext>
  )

  const PopoverTrigger = ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => {
    const { open, onOpenChange } = use(PopoverContext)
    const toggle = () => onOpenChange(!open)
    if (asChild && isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
      // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
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
    const { open } = use(PopoverContext)
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

const longNamedLanguage = createLanguage('es-es', 'Extraordinarily Long Language Name', '🇪🇸')

type BarProps = React.ComponentProps<typeof TranslateLanguageBar>

const baseProps = (): BarProps => ({
  sourceLanguage: 'auto',
  onSourceChange: vi.fn(),
  targetLanguage: english.langCode,
  onTargetChange: vi.fn(),
  detectedLanguage: null,
  isBidirectional: false,
  showSourceControls: true,
  bidirectionalPair: [english.langCode, chinese.langCode],
  couldExchange: false,
  onExchange: vi.fn()
})

describe('TranslateLanguageBar', () => {
  beforeEach(() => {
    mockUseLanguages.mockReset()
    mockT.mockReset()
    mockT.mockImplementation((key: string) => key)
    mockUseLanguages.mockReturnValue(createLanguagesHookResult())
  })

  it('sizes language selectors from the longest option label', () => {
    mockUseLanguages.mockReturnValue(createLanguagesHookResult([english, chinese, japanese, longNamedLanguage]))

    render(<TranslateLanguageBar {...baseProps()} />)

    expect(screen.getByRole('button', { name: sourceLanguageButtonName })).toHaveStyle({
      width: 'clamp(150px, calc(34ch + 72px), 260px)'
    })
    expect(screen.getByRole('button', { name: targetLanguageButtonName })).toHaveStyle({
      width: 'clamp(150px, calc(34ch + 72px), 260px)'
    })
  })

  it('renders source placeholder and target language labels', () => {
    render(<TranslateLanguageBar {...baseProps()} />)
    expect(screen.getByText('translate.source_language')).toBeInTheDocument()
    expect(screen.getByText('translate.target_language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.exchange.label' })).not.toBeInTheDocument()
  })

  it('renders an enabled swap action for exchangeable single-direction text', () => {
    const props = baseProps()
    props.sourceLanguage = chinese.langCode
    props.showSourceControls = false
    props.couldExchange = true

    render(<TranslateLanguageBar {...props} />)

    expect(screen.queryByRole('button', { name: sourceLanguageButtonName })).not.toBeInTheDocument()
    const swapButton = screen.getByRole('button', { name: 'translate.exchange.label' })
    expect(swapButton).toBeEnabled()
    expect(screen.getByRole('button', { name: targetLanguageButtonName })).toBeInTheDocument()

    fireEvent.click(swapButton)
    expect(props.onExchange).toHaveBeenCalled()
  })

  it('labels the lone target control so it explains what is being selected', () => {
    const props = baseProps()
    props.showSourceControls = false

    render(<TranslateLanguageBar {...props} />)

    expect(screen.getByText('translate.translate_to')).toBeInTheDocument()
    // The visible label is decorative: the control keeps its own accessible name.
    expect(screen.getByRole('button', { name: 'translate.target_language 🇬🇧 English' })).toBeInTheDocument()
  })

  it('omits the target label when the source control already provides context', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    expect(screen.queryByText('translate.translate_to')).not.toBeInTheDocument()
  })

  it('omits the target label in bidirectional mode', () => {
    const props = baseProps()
    props.isBidirectional = true
    props.showSourceControls = false

    render(<TranslateLanguageBar {...props} />)

    expect(screen.queryByText('translate.translate_to')).not.toBeInTheDocument()
  })

  it('opens source dropdown and calls onSourceChange on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: sourceLanguageButtonName }))

    const options = screen.getAllByText('Chinese')
    fireEvent.click(options[0])

    expect(props.onSourceChange).toHaveBeenCalledWith(chinese.langCode)
  })

  it('exposes source dropdown options with listbox roles and selected state', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    fireEvent.click(screen.getByRole('button', { name: sourceLanguageButtonName }))

    const listbox = screen.getByRole('listbox')
    const autoOption = within(listbox).getByRole('option', { name: /translate\.detected\.language/ })
    expect(autoOption).toHaveAttribute('aria-selected', 'true')
  })

  it('does not render a search input for source languages', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    fireEvent.click(screen.getByRole('button', { name: sourceLanguageButtonName }))

    expect(screen.queryByPlaceholderText('common.search')).not.toBeInTheDocument()
  })

  it('selects auto option', () => {
    const props = baseProps()
    props.sourceLanguage = english.langCode
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: sourceLanguageButtonName }))
    fireEvent.click(screen.getByText('translate.detected.language'))

    expect(props.onSourceChange).toHaveBeenCalledWith('auto')
  })

  it('hides swap button when exchange is unavailable', () => {
    const props = baseProps()
    props.showSourceControls = false
    props.couldExchange = false
    render(<TranslateLanguageBar {...props} />)
    expect(screen.queryByRole('button', { name: 'translate.exchange.label' })).not.toBeInTheDocument()
  })

  it('renders bidirectional pair display without the source dropdown', () => {
    const props = baseProps()
    props.isBidirectional = true
    const { container } = render(<TranslateLanguageBar {...props} />)

    // The A ⇆ B text is present
    expect(container.textContent).toContain('English ⇆ Chinese')

    const pairButton = screen.getByRole('button', { name: 'English ⇆ Chinese' })
    expect(pairButton).toHaveClass('h-8', 'text-sm')
    expect(pairButton).not.toHaveClass('h-9')
    expect(screen.queryByRole('button', { name: sourceLanguageButtonName })).not.toBeInTheDocument()
  })

  it('uses contained focus feedback on language trigger buttons', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    const sourceButton = screen.getByRole('button', { name: sourceLanguageButtonName })
    const targetButton = screen.getByRole('button', { name: targetLanguageButtonName })

    expect(sourceButton).toHaveClass('focus-visible:bg-accent')
    expect(targetButton).toHaveClass('focus-visible:bg-accent')
    expect(sourceButton?.className).not.toContain('focus-visible:ring')
    expect(targetButton?.className).not.toContain('focus-visible:ring')
  })

  it('opens target dropdown and calls onTargetChange on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: targetLanguageButtonName }))

    const list = screen.getAllByText('Japanese')
    fireEvent.click(list[0])

    expect(props.onTargetChange).toHaveBeenCalledWith(japanese.langCode)
  })

  it('shows detected language hint when sourceLanguage is auto and detectedLanguage is set', () => {
    const props = baseProps()
    props.detectedLanguage = chinese.langCode
    render(<TranslateLanguageBar {...props} />)

    const sourceTrigger = screen.getByRole('button', { name: sourceLanguageButtonName })
    expect(within(sourceTrigger).getByText(/translate\.detected\.language \(Chinese\)/)).toBeInTheDocument()
  })

  it('accounts for CJK label width when sizing the auto detected source selector', () => {
    const simplifiedChinese = createLanguage('zh-cn', '简体中文', '🇨🇳')
    mockT.mockImplementation((key: string) => (key === 'translate.detected.language' ? '自动检测' : key))
    mockUseLanguages.mockReturnValue(createLanguagesHookResult([english, simplifiedChinese, japanese]))

    const props = baseProps()
    props.detectedLanguage = simplifiedChinese.langCode
    render(<TranslateLanguageBar {...props} />)

    expect(screen.getByRole('button', { name: sourceLanguageButtonName })).toHaveStyle({
      width: 'clamp(150px, calc(19ch + 72px), 260px)'
    })
  })

  it('keeps the auto source display when detection resolves to unknown', () => {
    const props = baseProps()
    props.detectedLanguage = 'unknown'
    render(<TranslateLanguageBar {...props} />)

    const sourceTrigger = screen.getByRole('button', { name: sourceLanguageButtonName })
    expect(within(sourceTrigger).getByText('🌐')).toBeInTheDocument()
    expect(within(sourceTrigger).getByText('translate.detected.language')).toBeInTheDocument()
    expect(within(sourceTrigger).queryByText(/Unknown/)).not.toBeInTheDocument()
  })
})
