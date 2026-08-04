import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../model/types/paintingData'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  files: [] as { id: string }[],
  generate: vi.fn(),
  generating: false,
  historyItems: [] as PaintingData[],
  historyIsLoading: false,
  persistedAt: undefined as string | undefined,
  saveCurrent: vi.fn(),
  submitting: false,
  templates: [] as { id: string; imageUrl: string; label: string; prompt: string }[]
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
    templates: mocks.templates
  })
}))

vi.mock('../components/Artboard', () => ({
  default: () => <div data-testid="painting-artboard" />
}))

vi.mock('../components/PaintingTemplateShowcase', () => ({
  default: ({
    prompt,
    templates,
    onSelect
  }: {
    prompt: string
    templates: readonly { id: string; imageUrl: string; label: string; prompt: string }[]
    onSelect: (prompt: string) => void
  }) => (
    <div data-testid="painting-template-showcase" role="group" aria-label="paintings.showcase.styles_label">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          aria-label={template.label}
          aria-pressed={prompt === template.prompt}
          onClick={() => onSelect(template.prompt)}
        />
      ))}
    </div>
  )
}))

vi.mock('../components/PaintingComposer', () => ({
  default: ({
    painting,
    submitting,
    onGenerate
  }: {
    painting: { prompt?: string }
    submitting: boolean
    onGenerate: () => void
  }) => (
    <div data-testid="painting-composer" style={{ height: painting.prompt ? 180 : 64 }}>
      <textarea aria-label="painting prompt" value={painting.prompt ?? ''} readOnly />
      <button type="button" disabled={submitting} onClick={onGenerate}>
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
    submitting: mocks.submitting,
    submit: mocks.generate,
    cancel: mocks.cancel
  })
}))

vi.mock('../hooks/usePaintingHistory', () => ({
  usePaintingHistory: () => ({
    items: mocks.historyItems,
    isLoading: mocks.historyIsLoading,
    hasMore: false,
    loadMore: vi.fn()
  })
}))

vi.mock('../hooks/usePaintingInitialProvider', () => ({
  usePaintingInitialProvider: () => ({ initialProviderId: 'provider-1' })
}))

vi.mock('../hooks/usePaintingInitialDraft', () => ({
  usePaintingInitialDraft: vi.fn()
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
    params: {},
    persistedAt: mocks.persistedAt
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
    mocks.historyItems = []
    mocks.historyIsLoading = false
    mocks.persistedAt = undefined
    mocks.saveCurrent.mockReset()
    mocks.submitting = false
    mocks.templates = Array.from({ length: 25 }, (_, index) => ({
      id: index === 0 ? 'human-fragments-motion' : `template-${index}`,
      imageUrl: `/template-${index}.webp`,
      label: index === 0 ? 'Motion Step' : `painting template ${index}`,
      prompt: index === 0 ? 'Create a poster for ${CITY RHYTHM}' : `painting prompt ${index}`
    }))
  })

  it('shows the template showcase only on the untouched blank page', () => {
    render(<PaintingPage />)

    expect(screen.getByRole('heading', { name: 'paintings.showcase.title' })).toBeInTheDocument()
    expect(screen.getByTestId('painting-template-showcase')).toBeInTheDocument()
    expect(screen.queryByTestId('painting-artboard')).not.toBeInTheDocument()
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
    expect(screen.queryByTestId('painting-template-showcase')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
  })

  it('keeps persisted empty paintings on the normal artboard', () => {
    mocks.persistedAt = '2026-01-01T00:00:00.000Z'

    render(<PaintingPage />)

    expect(screen.queryByTestId('painting-template-showcase')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
  })

  it('shows the empty-page showcase while painting history is loading', () => {
    mocks.historyIsLoading = true

    render(<PaintingPage />)

    expect(screen.getByTestId('painting-template-showcase')).toBeInTheDocument()
    expect(screen.queryByTestId('painting-artboard')).not.toBeInTheDocument()
  })

  it('shows an explicit new blank draft after bootstrap even when history exists', () => {
    mocks.historyItems = [
      {
        id: 'persisted-painting',
        providerId: 'provider-1',
        mode: 'generate',
        prompt: 'persisted prompt',
        files: [],
        persistedAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    render(<PaintingPage />)

    expect(screen.getByTestId('painting-template-showcase')).toBeInTheDocument()
    expect(screen.queryByTestId('painting-artboard')).not.toBeInTheDocument()
  })

  it('hides the showcase and disables send while submit validation is pending', () => {
    mocks.submitting = true

    render(<PaintingPage />)

    expect(screen.queryByTestId('painting-template-showcase')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'generate' })).toBeDisabled()
  })

  it('keeps the normal artboard placeholder while the template catalog is unavailable', () => {
    mocks.templates = []

    render(<PaintingPage />)

    expect(screen.getByRole('heading', { name: 'paintings.showcase.title' })).toBeInTheDocument()
    expect(screen.queryByTestId('painting-template-showcase')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
    expect(screen.getByText('paintings.showcase.caption')).toBeInTheDocument()
  })

  it('keeps the generated-image stage free of template showcase chrome', () => {
    mocks.files = [{ id: 'generated-image' }]

    render(<PaintingPage />)

    expect(screen.queryByRole('heading', { name: 'paintings.showcase.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'paintings.showcase.styles_label' })).not.toBeInTheDocument()
    expect(screen.queryByText('paintings.showcase.caption')).not.toBeInTheDocument()
    expect(screen.queryByTestId('painting-template-showcase')).not.toBeInTheDocument()
    expect(screen.getByTestId('painting-artboard')).toBeInTheDocument()
  })

  it('fills the prompt from a style choice without starting generation', () => {
    render(<PaintingPage />)

    const templateStage = screen.getByTestId('painting-template-stage')
    expect(templateStage).toHaveClass('absolute', 'inset-0', 'z-0', 'pb-36')
    expect(screen.getByTestId('painting-composer')).toHaveStyle({ height: '64px' })

    const templateButton = screen.getByRole('button', {
      name: 'Motion Step'
    })
    fireEvent.click(templateButton)

    expect(screen.getByRole('textbox', { name: 'painting prompt' })).toHaveValue('Create a poster for ${CITY RHYTHM}')
    expect(templateButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('painting-composer')).toHaveStyle({ height: '180px' })
    expect(screen.getByTestId('painting-template-stage')).toBe(templateStage)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
