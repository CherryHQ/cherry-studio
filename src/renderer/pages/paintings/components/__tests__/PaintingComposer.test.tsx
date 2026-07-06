import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

// Keep t() returning raw keys: the renderer setup now initializes real i18n, but
// these assertions match the params button on its stable `common.settings` key.
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const captured = { surfaceProps: undefined as ComposerSurfaceProps | undefined }
const mockUseImageGenerationSupport = vi.hoisted(() => vi.fn())

const imageGenerationSupportWithFields = {
  modes: {
    generate: {
      supports: {
        background: { type: 'enum', options: ['auto', 'transparent', 'opaque'], default: 'auto' },
        numImages: { type: 'range', min: 1, max: 10, default: 1 },
        quality: { type: 'enum', options: ['auto', 'low', 'medium', 'high'], default: 'auto' },
        size: { type: 'enum', options: ['auto', '1024x1024', '1536x1024', '1024x1536'], default: '1024x1024' }
      }
    }
  }
}

// Stand in for the Tiptap surface: expose the text + send wiring the variant drives.
vi.mock('@renderer/components/composer/ComposerSurface', () => ({
  default: (props: ComposerSurfaceProps) => {
    captured.surfaceProps = props
    return (
      <div>
        <textarea
          aria-label="prompt"
          value={props.text}
          disabled={props.sendDisabled && false}
          onChange={(event) => props.onTextChange(event.target.value)}
        />
        <button
          type="button"
          aria-label="send"
          disabled={props.sendDisabled}
          onClick={() => props.onSendDraft({ text: props.text, tokens: [] })}>
          send
        </button>
        {props.renderLeftControls?.(undefined, { available: true, open: () => undefined })}
      </div>
    )
  }
}))

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ComposerToolDerivedStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ComposerToolRuntimeHost: () => null,
  useComposerToolState: () => ({ files: [], isExpanded: false }),
  useComposerToolDispatch: () => ({ setFiles: vi.fn(), setIsExpanded: vi.fn() }),
  useComposerToolLauncherActions: () => ({ getLaunchers: () => [], dispatchLauncher: vi.fn() }),
  useComposerToolLauncherVersion: () => 0,
  useComposerTokenReconcile: () => vi.fn()
}))

vi.mock('@renderer/components/composer/tools/registry', () => ({
  getComposerToolConfig: () => ({ enableQuickPanel: true, enableDragDrop: true })
}))

vi.mock('@renderer/components/composer/variants/shared/ComposerControlScaffolding', () => ({
  COMPOSER_SELECTOR_BUTTON_CLASS: '',
  ComposerToolbarControls: ({
    renderContextControls,
    unifiedPanelControl
  }: {
    renderContextControls: (a: { side: string; iconOnly: boolean }) => React.ReactNode
    unifiedPanelControl?: { available: boolean }
  }) => (
    <div>
      {renderContextControls({ side: 'bottom', iconOnly: false })}
      {unifiedPanelControl?.available ? <div data-testid="painting-plus-control" /> : null}
    </div>
  )
}))

vi.mock('@renderer/components/composer/variants/shared/composerTokens', () => ({
  fileToComposerToken: vi.fn()
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.message.font_size' ? 14 : false]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({
    models: [{ providerId: 'openai', apiModelId: 'gpt-image-1', name: 'GPT Image', type: ['image_gen'] }]
  })
}))

vi.mock('@shared/utils/model', () => ({ isEditImageModel: () => false }))

vi.mock('../../hooks/usePaintingComposerInputFiles', () => ({ usePaintingComposerInputFiles: vi.fn() }))

vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: mockUseImageGenerationSupport
}))

vi.mock('../PaintingModelSelector', () => ({
  default: () => <div data-testid="painting-model-selector" />
}))

vi.mock('../PaintingSettings', () => ({
  default: () => <div data-testid="painting-settings" />
}))

// Imported after mocks are registered.
const { default: PaintingComposer } = await import('../PaintingComposer')

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-image-1',
    mode: 'generate',
    prompt: '',
    files: [],
    ...overrides
  }) as PaintingData

const renderComposer = (props: Partial<React.ComponentProps<typeof PaintingComposer>> = {}) => {
  const onPromptChange = vi.fn()
  const onGenerate = vi.fn()
  const handlers = {
    painting: makePainting(),
    generating: false,
    onPromptChange,
    onInputFilesChange: vi.fn(),
    onGenerate,
    onCancel: vi.fn(),
    onModelSelect: vi.fn(),
    onConfigChange: vi.fn(),
    onGenerateRandomSeed: vi.fn(),
    ...props
  }
  render(<PaintingComposer {...(handlers as React.ComponentProps<typeof PaintingComposer>)} />)
  return { onPromptChange, onGenerate }
}

describe('PaintingComposer', () => {
  beforeEach(() => {
    captured.surfaceProps = undefined
    mockUseImageGenerationSupport.mockReset()
    mockUseImageGenerationSupport.mockReturnValue(imageGenerationSupportWithFields)
  })

  it('renders the model selector control in the toolbar', () => {
    renderComposer()
    expect(screen.getByTestId('painting-model-selector')).toBeInTheDocument()
  })

  it('passes the unified panel control to the toolbar', () => {
    renderComposer()
    expect(screen.getByTestId('painting-plus-control')).toBeInTheDocument()
  })

  it('reports prompt edits to the page', () => {
    const { onPromptChange } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'a cat' } })
    expect(onPromptChange).toHaveBeenCalledWith('a cat')
  })

  it('triggers generation on send', () => {
    const { onGenerate } = renderComposer({ painting: makePainting({ prompt: 'a cat' }) })
    fireEvent.click(screen.getByLabelText('send'))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('disables send while generating', () => {
    renderComposer({ generating: true, painting: makePainting({ prompt: 'a cat' }) })
    expect(screen.getByLabelText('send')).toBeDisabled()
  })

  it('does not render the image params button when imageGeneration support is missing', () => {
    mockUseImageGenerationSupport.mockReturnValue(undefined)

    renderComposer({ painting: makePainting({ providerId: 'openrouter', model: 'gpt-5-image' }) })

    expect(screen.queryByRole('button', { name: /common\.settings/ })).not.toBeInTheDocument()
  })

  it('renders the image params button when imageGeneration support produces fields', () => {
    mockUseImageGenerationSupport.mockReturnValue({
      modes: {
        generate: {
          supports: {
            size: { type: 'enum', options: ['1024x1024'], render: 'chips' }
          }
        }
      }
    })

    renderComposer({ painting: makePainting({ providerId: 'gateway', model: 'gpt-image-1' }) })

    expect(screen.getByRole('button', { name: /common\.settings/ })).toBeInTheDocument()
  })

  // The summary is folded into the params button's accessible name, so match on the
  // stable settings prefix rather than the full label.
  const paramsButton = () => screen.getByRole('button', { name: /common\.settings/ })

  it('previews the selected size on the params button', () => {
    renderComposer({ painting: makePainting({ params: { size: '1536x1024' } }) })
    expect(paramsButton()).toHaveTextContent('1536×1024')
  })

  it('previews registry defaults when nothing is stored', () => {
    renderComposer({ painting: makePainting({ params: {} }) })
    expect(paramsButton()).toHaveTextContent('1024×1024')
  })

  it('previews custom dimensions when size is custom', () => {
    renderComposer({
      painting: makePainting({ params: { size: 'custom', customSize_width: 800, customSize_height: 600 } })
    })
    expect(paramsButton()).toHaveTextContent('800×600')
  })

  it('previews count, quality and background alongside size', () => {
    renderComposer({ painting: makePainting({ params: { numImages: 6, quality: 'low', background: 'auto' } }) })
    const button = paramsButton()
    expect(button).toHaveTextContent('6')
    expect(button).toHaveTextContent('1024×1024')
    // i18next has no instance in tests, so option labels fall back to their keys.
    expect(button).toHaveTextContent('paintings.quality_options.low')
    expect(button).toHaveTextContent('paintings.background_options.auto')
  })

  it('folds the summary into the params button accessible name', () => {
    renderComposer({ painting: makePainting({ params: { size: '1536x1024' } }) })
    // Summary (incl. registry defaults) is appended after the settings label.
    expect(paramsButton()).toHaveAccessibleName(/^common\.settings: .*1536×1024/)
  })
})
