// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../model/types/paintingData'

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({
    id: 'painting-1',
    providerId: 'openai',
    model: 'gpt-image-1',
    mode: 'generate',
    prompt: '',
    files: [],
    params: {},
    ...overrides
  }) as PaintingData

const painting = makePainting()

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => [null]
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('../components/Artboard', () => ({
  default: () => <section data-testid="painting-artboard" />
}))

vi.mock('../components/PaintingComposer', () => ({
  default: () => <section data-testid="painting-composer" />
}))

vi.mock('../components/PaintingStrip', () => ({
  default: () => <aside data-testid="painting-strip" />
}))

vi.mock('../hooks/usePaintingGenerationSubmit', () => ({
  usePaintingGenerationSubmit: () => ({
    generating: false,
    submit: vi.fn(),
    cancel: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingHistory', () => ({
  usePaintingHistory: () => ({
    items: [painting],
    hasMore: false,
    loadMore: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingInitialProvider', () => ({
  usePaintingInitialProvider: () => ({
    initialProviderId: 'openai'
  })
}))

vi.mock('../hooks/usePaintingInitialSelection', () => ({
  usePaintingInitialSelection: vi.fn()
}))

vi.mock('../hooks/usePaintingList', () => ({
  usePaintingList: () => ({
    add: vi.fn(),
    remove: vi.fn(),
    saveCurrent: vi.fn(),
    select: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingModelCatalog', () => ({
  usePaintingModelCatalog: () => ({
    currentModelOptions: [{ value: 'gpt-image-1' }],
    ensureCurrentCatalog: vi.fn(),
    ensureProviderCatalog: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingModelSwitch', () => ({
  usePaintingModelSwitch: () => vi.fn()
}))

vi.mock('../hooks/usePaintingProviderOptions', () => ({
  usePaintingProviderOptions: () => [{ id: 'openai', name: 'OpenAI' }]
}))

const { default: PaintingPage } = await import('../index')

describe('PaintingPage layout', () => {
  it('renders the painting strip before the artboard so history stays on the left', () => {
    render(<PaintingPage />)

    const strip = screen.getByTestId('painting-strip')
    const artboard = screen.getByTestId('painting-artboard')

    expect(strip.compareDocumentPosition(artboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('limits the bottom composer width on wide screens', () => {
    render(<PaintingPage />)

    const composer = screen.getByTestId('painting-composer')

    expect(composer.parentElement).toHaveClass('mx-auto', 'w-full', 'max-w-[960px]')
  })
})
