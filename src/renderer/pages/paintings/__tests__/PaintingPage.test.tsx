import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  files: [] as { id: string }[],
  generate: vi.fn(),
  generating: false,
  saveCurrent: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: () => [undefined]
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('../hooks/usePaintingTemplateCatalog', () => ({
  usePaintingTemplateCatalog: () => ({
    templates: Array.from({ length: 25 }, (_, index) => ({
      id: index === 0 ? 'human-fragments-motion' : `template-${index}`,
      imageUrl: `/template-${index}.webp`,
      label: index === 0 ? 'Motion Step' : `painting template ${index}`,
      prompt: index === 0 ? 'Create a poster for ${CITY RHYTHM}' : `painting prompt ${index}`
    }))
  })
}))

vi.mock('../components/Artboard', () => ({
  default: ({
    painting,
    styleGroupLabel,
    stylePresets,
    onStyleSelect
  }: {
    painting: { prompt?: string }
    styleGroupLabel?: string
    stylePresets?: readonly { id: string; imageUrl: string; label: string; prompt: string }[]
    onStyleSelect?: (prompt: string) => void
  }) => (
    <div data-testid="painting-artboard" role="group" aria-label={styleGroupLabel}>
      {stylePresets?.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-label={preset.label}
          aria-pressed={painting.prompt === preset.prompt}
          onClick={() => onStyleSelect?.(preset.prompt)}
        />
      ))}
    </div>
  )
}))

vi.mock('../components/PaintingComposer', () => ({
  default: ({ painting, onGenerate }: { painting: { prompt?: string }; onGenerate: () => void }) => (
    <div data-testid="painting-composer">
      <textarea aria-label="painting prompt" value={painting.prompt ?? ''} readOnly />
      <button type="button" onClick={onGenerate}>
        generate
      </button>
    </div>
  )
}))

vi.mock('../components/PaintingStrip', () => ({
  default: () => <div data-testid="painting-strip" />
}))

vi.mock('../hooks/usePaintingGenerationSubmit', () => ({
  usePaintingGenerationSubmit: () => ({
    generating: mocks.generating,
    submit: mocks.generate,
    cancel: mocks.cancel
  })
}))

vi.mock('../hooks/usePaintingHistory', () => ({
  usePaintingHistory: () => ({
    items: [],
    hasMore: false,
    loadMore: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingInitialProvider', () => ({
  usePaintingInitialProvider: () => ({ initialProviderId: 'provider-1' })
}))

vi.mock('../hooks/usePaintingInitialSelection', () => ({
  usePaintingInitialSelection: vi.fn()
}))

vi.mock('../hooks/usePaintingList', () => ({
  usePaintingList: () => ({
    add: vi.fn(),
    remove: vi.fn(),
    saveCurrent: mocks.saveCurrent,
    select: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingModelCatalog', () => ({
  usePaintingModelCatalog: () => ({
    currentModelOptions: [{ value: 'model-1' }],
    ensureCurrentCatalog: vi.fn(),
    ensureProviderCatalog: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingModelSwitch', () => ({
  usePaintingModelSwitch: () => vi.fn()
}))

vi.mock('../hooks/usePaintingProviderOptions', () => ({
  usePaintingProviderOptions: () => []
}))

vi.mock('../hooks/usePaintingResultSync', () => ({
  usePaintingResultSync: vi.fn()
}))

vi.mock('../model/paintingPipeline', () => ({
  createDefaultPainting: (providerId: string) => ({
    id: 'painting-1',
    providerId,
    mode: 'generate',
    prompt: '',
    files: mocks.files,
    params: {}
  })
}))

vi.mock('../model/utils/paintingGenerationParams', () => ({
  cacheToPaintingGenerationState: () => ({})
}))

const { default: PaintingPage } = await import('../PaintingPage')

describe('PaintingPage showcase', () => {
  beforeEach(() => {
    mocks.cancel.mockReset()
    mocks.files = []
    mocks.generate.mockReset()
    mocks.generating = false
    mocks.saveCurrent.mockReset()
  })

  it('shows the template showcase only on the untouched blank page', () => {
    render(<PaintingPage />)

    expect(screen.getByRole('heading', { name: 'paintings.showcase.title' })).toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'paintings.showcase.styles_label' })).getAllByRole('button')
    ).toHaveLength(25)
    expect(screen.getByText('paintings.showcase.caption')).toBeInTheDocument()
    expect(screen.getByTestId('painting-composer')).toBeInTheDocument()
  })

  it('removes the template showcase as soon as image generation starts', () => {
    mocks.generating = true

    render(<PaintingPage />)

    expect(screen.queryByRole('heading', { name: 'paintings.showcase.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'paintings.showcase.styles_label' })).not.toBeInTheDocument()
    expect(screen.queryByText('paintings.showcase.caption')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
  })

  it('keeps the generated-image stage free of template showcase chrome', () => {
    mocks.files = [{ id: 'generated-image' }]

    render(<PaintingPage />)

    expect(screen.queryByRole('heading', { name: 'paintings.showcase.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'paintings.showcase.styles_label' })).not.toBeInTheDocument()
    expect(screen.queryByText('paintings.showcase.caption')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
  })

  it('fills the prompt from a style choice without starting generation', () => {
    render(<PaintingPage />)

    const templateButton = screen.getByRole('button', {
      name: 'Motion Step'
    })
    fireEvent.click(templateButton)

    expect(screen.getByRole('textbox', { name: 'painting prompt' })).toHaveValue('Create a poster for ${CITY RHYTHM}')
    expect(templateButton).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
