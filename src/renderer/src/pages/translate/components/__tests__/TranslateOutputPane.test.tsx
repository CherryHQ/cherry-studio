import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import TranslateOutputPane from '../TranslateOutputPane'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const baseProps = () => ({
  translatedContent: '',
  renderedMarkdown: '',
  enableMarkdown: false,
  translating: false,
  copied: false,
  couldTranslate: true,
  onCopy: vi.fn(),
  onTranslate: vi.fn(),
  onAbort: vi.fn(),
  onScroll: vi.fn()
})

describe('TranslateOutputPane', () => {
  it('uses bg-secondary for abort button when translating and preserves lucide-custom icon class', () => {
    const props = baseProps()
    props.translating = true
    props.translatedContent = 'partial output'

    render(<TranslateOutputPane {...props} />)

    const stopButton = screen.getByRole('button', { name: 'common.stop' })
    expect(stopButton.className).toContain('bg-secondary')
    expect(stopButton.className).not.toContain('bg-destructive')
    expect(stopButton.querySelector('svg')?.className.baseVal).toContain('lucide-custom')
  })

  it('keeps translate action icon using lucide-custom class', () => {
    const props = baseProps()
    props.couldTranslate = true

    render(<TranslateOutputPane {...props} />)

    const translateButton = screen.getByRole('button', { name: 'translate.button.translate' })
    expect(translateButton.querySelector('svg')?.className.baseVal).toContain('lucide-custom')
    fireEvent.click(translateButton)
    expect(props.onTranslate).toHaveBeenCalledTimes(1)
  })
})
