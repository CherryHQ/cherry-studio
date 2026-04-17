import type { TranslateLanguage } from '@renderer/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateLanguageBar from '../TranslateLanguageBar'

const mockDbPut = vi.fn()
const mockUseTranslate = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useTranslate', () => ({
  default: () => mockUseTranslate()
}))

vi.mock('@renderer/databases', () => ({
  default: { settings: { put: (...args: unknown[]) => mockDbPut(...args) } }
}))

vi.mock('@renderer/config/translate', () => ({
  UNKNOWN: { value: 'Unknown', langCode: 'unknown', label: () => 'Unknown', emoji: '🏳️' }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ComponentProps<'button'>) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const english: TranslateLanguage = { value: 'English', langCode: 'en-us', label: () => 'English', emoji: '🇬🇧' }
const chinese: TranslateLanguage = { value: 'Chinese', langCode: 'zh-cn', label: () => 'Chinese', emoji: '🇨🇳' }
const japanese: TranslateLanguage = { value: 'Japanese', langCode: 'ja-jp', label: () => 'Japanese', emoji: '🇯🇵' }

type BarProps = React.ComponentProps<typeof TranslateLanguageBar>

const baseProps = (): BarProps => ({
  sourceLanguage: 'auto',
  onSourceChange: vi.fn(),
  targetLanguage: english,
  onTargetChange: vi.fn(),
  detectedLanguage: null,
  isBidirectional: false,
  bidirectionalPair: [english, chinese],
  couldExchange: true,
  onExchange: vi.fn()
})

describe('TranslateLanguageBar', () => {
  beforeEach(() => {
    mockDbPut.mockReset()
    mockUseTranslate.mockReturnValue({ translateLanguages: [english, chinese, japanese] })
  })

  it('renders source placeholder and target language labels', () => {
    render(<TranslateLanguageBar {...baseProps()} />)
    expect(screen.getByText('translate.source_language')).toBeInTheDocument()
    expect(screen.getByText('translate.target_language')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('opens source dropdown and calls onSourceChange + persists langCode on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.source_language'))

    const options = screen.getAllByText('Chinese')
    fireEvent.click(options[0])

    expect(props.onSourceChange).toHaveBeenCalledWith(chinese)
    expect(mockDbPut).toHaveBeenCalledWith({ id: 'translate:source:language', value: 'zh-cn' })
  })

  it('selects auto option and persists "auto"', () => {
    const props = baseProps()
    props.sourceLanguage = english
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.source_language'))
    fireEvent.click(screen.getByText('translate.detected.language'))

    expect(props.onSourceChange).toHaveBeenCalledWith('auto')
    expect(mockDbPut).toHaveBeenCalledWith({ id: 'translate:source:language', value: 'auto' })
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

  it('opens target dropdown and calls onTargetChange on select', () => {
    const props = baseProps()
    render(<TranslateLanguageBar {...props} />)

    fireEvent.click(screen.getByText('translate.target_language'))

    const list = screen.getAllByText('Japanese')
    fireEvent.click(list[0])

    expect(props.onTargetChange).toHaveBeenCalledWith(japanese)
    expect(mockDbPut).toHaveBeenCalledWith({ id: 'translate:target:language', value: 'ja-jp' })
  })

  it('shows detected language hint when sourceLanguage is auto and detectedLanguage is set', () => {
    const props = baseProps()
    props.detectedLanguage = chinese
    render(<TranslateLanguageBar {...props} />)

    // Inside the source trigger the label contains "(Chinese)"
    const sourceTrigger = screen.getByText('translate.source_language').closest('button')
    expect(within(sourceTrigger!).getByText(/translate\.detected\.language \(Chinese\)/)).toBeInTheDocument()
  })
})
