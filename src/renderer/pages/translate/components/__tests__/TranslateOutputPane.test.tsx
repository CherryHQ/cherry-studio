import { render, screen } from '@testing-library/react'
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
  onCopy: vi.fn(),
  onScroll: vi.fn()
})

describe('TranslateOutputPane', () => {
  it('renders no placeholder when there is no translated content', () => {
    render(<TranslateOutputPane {...baseProps()} />)

    expect(screen.queryByText('translate.output.placeholder')).not.toBeInTheDocument()
  })

  it('shows the processing indicator while translating with no content yet', () => {
    const props = baseProps()
    props.translating = true

    render(<TranslateOutputPane {...props} />)

    expect(screen.getByText('translate.processing')).toBeInTheDocument()
  })

  it('renders the character count', () => {
    const props = baseProps()
    props.translatedContent = 'hello'

    render(<TranslateOutputPane {...props} />)

    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
