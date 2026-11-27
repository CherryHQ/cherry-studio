import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateLanguageBar from '../TranslateLanguageBar'
import { chinese, createLanguagesHookResult, english, japanese } from './testUtils'

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

type BarProps = React.ComponentProps<typeof TranslateLanguageBar>

const baseProps = (): BarProps => ({
  sourceLanguage: 'auto',
  onSourceChange: vi.fn(),
  targetLanguage: english.langCode,
  onTargetChange: vi.fn(),
  detectedLanguage: null,
  isBidirectional: false,
  showSourceControls: true,
  bidirectionalPair: [english.langCode, chinese.langCode]
})

describe('TranslateLanguageBar', () => {
  beforeEach(() => {
    mockUseLanguages.mockReset()
    mockT.mockReset()
    mockT.mockImplementation((key: string) => key)
    mockUseLanguages.mockReturnValue(createLanguagesHookResult())
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

  it('selects auto option', () => {
    const props = baseProps()
    props.sourceLanguage = english.langCode
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: sourceLanguageButtonName }))
    fireEvent.click(screen.getByText('translate.detected.language'))

    expect(props.onSourceChange).toHaveBeenCalledWith('auto')
  })

  it('keeps PDF source and target controls without an unusable exchange button', () => {
    render(<TranslateLanguageBar {...baseProps()} />)

    expect(screen.getByRole('button', { name: sourceLanguageButtonName })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: targetLanguageButtonName })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.exchange.label' })).not.toBeInTheDocument()
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
