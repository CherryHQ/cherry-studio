import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

const captured = { surfaceProps: undefined as ComposerSurfaceProps | undefined }

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
        {props.renderLeftControls?.()}
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
  useComposerTokenReconcile: () => vi.fn()
}))

vi.mock('@renderer/components/composer/tools/registry', () => ({
  getComposerToolConfig: () => ({ enableQuickPanel: false, enableDragDrop: true })
}))

vi.mock('@renderer/components/composer/variants/shared/ComposerControlScaffolding', () => ({
  COMPOSER_SELECTOR_BUTTON_CLASS: '',
  ComposerToolbarControls: ({
    renderContextControls
  }: {
    renderContextControls: (a: { side: string; iconOnly: boolean }) => React.ReactNode
  }) => <div>{renderContextControls({ side: 'bottom', iconOnly: false })}</div>
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
  })

  it('renders the model selector control in the toolbar', () => {
    renderComposer()
    expect(screen.getByTestId('painting-model-selector')).toBeInTheDocument()
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
})
