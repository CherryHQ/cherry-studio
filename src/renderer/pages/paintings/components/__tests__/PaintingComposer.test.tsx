import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import { FILE_TYPE } from '@renderer/types/file'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const mockMaterializeInputs = vi.hoisted(() => vi.fn())
const mockIsEditImageModel = vi.hoisted(() => vi.fn(() => false))
// The composer's live draft attachments. Mutable because the image-required gate
// reads them, and its whole contract is that it tracks the draft rather than the
// last-generated `painting.inputFiles`.
const composerState = vi.hoisted(() => ({ files: [] as ComposerAttachment[] }))

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
  useComposerToolState: () => ({ files: composerState.files, isExpanded: false }),
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

vi.mock('@shared/utils/model', () => ({ isEditImageModel: mockIsEditImageModel }))

vi.mock('../PaintingImageGallery', () => ({
  PaintingImageGallery: () => <div data-testid="painting-image-gallery" />,
  PaintingImageAddButton: () => <button type="button" data-testid="painting-image-add" />
}))

vi.mock('../../hooks/usePaintingComposerInputFiles', () => ({
  usePaintingComposerInputFiles: () => ({ materializeInputs: mockMaterializeInputs })
}))

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
    submitting: false,
    onPromptChange,
    onGenerate,
    onCancel: vi.fn(),
    onModelSelect: vi.fn(),
    onConfigChange: vi.fn(),
    onGenerateRandomSeed: vi.fn(),
    ...props
  }
  const view = render(<PaintingComposer {...(handlers as React.ComponentProps<typeof PaintingComposer>)} />)
  return {
    onPromptChange,
    onGenerate,
    rerenderPainting: (painting: PaintingData) =>
      view.rerender(
        <PaintingComposer {...(handlers as React.ComponentProps<typeof PaintingComposer>)} painting={painting} />
      )
  }
}

const imageAttachment = (id: string): ComposerAttachment => ({
  fileTokenSourceId: id,
  path: `/tmp/${id}.png` as AbsoluteFilePath,
  name: id,
  origin_name: `${id}.png`,
  ext: '.png',
  size: 1,
  type: FILE_TYPE.IMAGE
})

/** Edit-only: an `edit` mode and no `generate` mode ⇒ an image is mandatory. */
const editOnlySupport = { modes: { edit: { supports: {} } } }

describe('PaintingComposer', () => {
  beforeEach(() => {
    captured.surfaceProps = undefined
    composerState.files = []
    mockUseImageGenerationSupport.mockReset()
    mockUseImageGenerationSupport.mockReturnValue(imageGenerationSupportWithFields)
    mockMaterializeInputs.mockReset()
    mockMaterializeInputs.mockResolvedValue({ entries: [], complete: true })
    mockIsEditImageModel.mockReset()
    mockIsEditImageModel.mockReturnValue(false)
  })

  it('renders the top image strip + add button and drops file pills for edit-image models', () => {
    mockIsEditImageModel.mockReturnValue(true)
    renderComposer()
    expect(captured.surfaceProps?.topContent).toBeTruthy()
    expect(captured.surfaceProps?.leadingContent).toBeTruthy()
    expect(captured.surfaceProps?.tokens).toEqual([])
    expect(captured.surfaceProps?.managedTokenKinds).toEqual([])
  })

  it('keeps file pills and no image tray for non-edit models', () => {
    renderComposer()
    expect(captured.surfaceProps?.topContent).toBeUndefined()
    expect(captured.surfaceProps?.leadingContent).toBeUndefined()
    expect(captured.surfaceProps?.managedTokenKinds).toEqual(['file'])
  })

  it('gates send and shows a reason for edit-only models missing an image', () => {
    mockIsEditImageModel.mockReturnValue(true)
    mockUseImageGenerationSupport.mockReturnValue(editOnlySupport)
    renderComposer({ painting: makePainting({ prompt: 'make the sky purple' }) })
    // Blocked even with prompt text, because no image is attached (files mock is empty).
    expect(captured.surfaceProps?.sendDisabled).toBe(true)
    expect(captured.surfaceProps?.sendBlockedReason).toBe('paintings.edit.image_required')
    expect(captured.surfaceProps?.placeholder).toBe('paintings.prompt_placeholder_upload_required')
  })

  it('releases the edit-only gate as soon as an image is in the draft', () => {
    // The gate must read the draft, not `painting.inputFiles`. Inputs are only
    // materialized onto the painting at generate time, so on a fresh edit-only
    // painting `inputFiles` stays empty no matter how many images are attached —
    // gating on it left send permanently disabled and materialization unreachable.
    mockIsEditImageModel.mockReturnValue(true)
    mockUseImageGenerationSupport.mockReturnValue(editOnlySupport)
    composerState.files = [imageAttachment('a')]
    renderComposer({ painting: makePainting({ prompt: 'make the sky purple', inputFiles: [] }) })
    expect(captured.surfaceProps?.sendDisabled).toBe(false)
    expect(captured.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('re-arms the edit-only gate when the last draft image is removed', () => {
    // The mirror failure: a painting that already generated carries entries in
    // `inputFiles`, so a gate reading them stays open after the user clears the
    // tray — and the send would reach the model with no image at all.
    mockIsEditImageModel.mockReturnValue(true)
    mockUseImageGenerationSupport.mockReturnValue(editOnlySupport)
    composerState.files = []
    renderComposer({
      painting: makePainting({
        prompt: 'make the sky purple',
        inputFiles: [{ id: 'fe-1', ext: 'png' } as unknown as FileEntry]
      })
    })
    expect(captured.surfaceProps?.sendDisabled).toBe(true)
    expect(captured.surfaceProps?.sendBlockedReason).toBe('paintings.edit.image_required')
  })

  it('ignores non-image draft attachments when gating an edit-only model', () => {
    mockIsEditImageModel.mockReturnValue(true)
    mockUseImageGenerationSupport.mockReturnValue(editOnlySupport)
    composerState.files = [{ ...imageAttachment('doc'), ext: '.pdf', type: FILE_TYPE.DOCUMENT }]
    renderComposer({ painting: makePainting({ prompt: 'make the sky purple' }) })
    expect(captured.surfaceProps?.sendDisabled).toBe(true)
    expect(captured.surfaceProps?.sendBlockedReason).toBe('paintings.edit.image_required')
  })

  it('does not gate on image for edit models that can also generate from text', () => {
    mockIsEditImageModel.mockReturnValue(true)
    mockUseImageGenerationSupport.mockReturnValue({
      modes: { generate: { supports: {} }, edit: { supports: {} } }
    })
    renderComposer({ painting: makePainting({ prompt: 'a cat' }) })
    expect(captured.surfaceProps?.sendDisabled).toBe(false)
    expect(captured.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('renders the model selector and unified panel controls in the toolbar', () => {
    renderComposer()
    expect(screen.getByTestId('painting-model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('painting-plus-control')).toBeInTheDocument()
  })

  it('reports prompt edits to the page', () => {
    const { onPromptChange } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'a cat' } })
    expect(onPromptChange).toHaveBeenCalledWith('a cat')
  })

  it('syncs an externally selected prompt into the composer', () => {
    const { rerenderPainting } = renderComposer()

    rerenderPainting(makePainting({ prompt: 'a cinematic coastal house' }))

    expect(screen.getByLabelText('prompt')).toHaveValue('a cinematic coastal house')
  })

  it('hands the request its input resolver rather than resolved inputs', async () => {
    // The composer no longer orchestrates the send: materialization is the first
    // step of the request, run by its owner only after the preconditions pass.
    // What it owes the page is the capability, not the data.
    const { onGenerate } = renderComposer({ painting: makePainting({ prompt: 'a cat' }) })
    fireEvent.click(screen.getByLabelText('send'))
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1))
    expect(onGenerate).toHaveBeenCalledWith(mockMaterializeInputs)
    // Nothing is materialized by the act of pressing send.
    expect(mockMaterializeInputs).not.toHaveBeenCalled()
  })

  it('disables send while a request it started is in flight', () => {
    renderComposer({ submitting: true, painting: makePainting({ prompt: 'a cat' }) })
    expect(screen.getByLabelText('send')).toBeDisabled()
  })

  it('disables send while generating', () => {
    renderComposer({ generating: true, painting: makePainting({ prompt: 'a cat' }) })
    expect(screen.getByLabelText('send')).toBeDisabled()
  })

  it('disables send while a request is in flight without showing the generation spinner', () => {
    // `submitting` and `generating` disable the button alike, but only `generating`
    // means the model is actually working — the pre-request window (guard +
    // materialize) must not render as generation in progress.
    //
    // Note this asserts the *disabled* affordance only. Refusing a re-entrant send
    // is the request owner's job (`usePaintingGenerationSubmit` holds the ref that
    // blocks a second call in the same tick, covered by its own test); the composer
    // deliberately keeps no send state to guard with.
    renderComposer({ submitting: true, painting: makePainting({ prompt: 'a cat' }) })

    expect(screen.getByLabelText('send')).toBeDisabled()
    expect(captured.surfaceProps?.isLoading).toBe(false)
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

  it('localizes the selected size through the shared option label instead of the raw enum', () => {
    renderComposer({ painting: makePainting({ params: { size: 'auto' } }) })
    // The summary must route `auto` through resolveOptions/sizeOptionLabel (its
    // localized labelKey) like the chips and prompt bar — not surface the bare
    // `auto` enum that deriveChipLabel(value, value) previously leaked here.
    expect(paramsButton()).toHaveTextContent('paintings.image_size_options.auto')
  })

  it('previews custom dimensions when size is custom', () => {
    renderComposer({
      painting: makePainting({ params: { size: 'custom', customSize_width: 800, customSize_height: 600 } })
    })
    expect(paramsButton()).toHaveTextContent('800×600')
  })

  it('does not preview invalid custom dimensions', () => {
    renderComposer({
      painting: makePainting({ params: { size: 'custom', customSize_width: 0, customSize_height: 600 } })
    })
    expect(paramsButton()).not.toHaveTextContent('0×600')
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

  it('previews the typed slider fallback for a malformed stored value', () => {
    renderComposer({ painting: makePainting({ params: { numImages: true } }) })
    const summaryParts = paramsButton().textContent?.split(' · ') ?? []
    expect(summaryParts).toContain('1')
    expect(summaryParts).not.toContain('true')
  })

  it('uses a typed option fallback while preserving a stale numeric slider value', () => {
    renderComposer({ painting: makePainting({ params: { size: true, numImages: '2.5' } }) })
    const summaryParts = paramsButton().textContent?.split(' · ') ?? []

    expect(summaryParts).toContain('1024×1024')
    expect(summaryParts).toContain('2.5')
    expect(summaryParts).not.toContain('true')
  })

  it('folds the summary into the params button accessible name', () => {
    renderComposer({ painting: makePainting({ params: { size: '1536x1024' } }) })
    // Summary (incl. registry defaults) is appended after the settings label.
    expect(paramsButton()).toHaveAccessibleName(/^common\.settings: .*1536×1024/)
  })
})
