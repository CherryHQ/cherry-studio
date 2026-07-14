import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import type { VideoGenerationSupport } from '@shared/data/types/model'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Keep t() returning raw keys — assertions match stable i18n keys.
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const captured = { surfaceProps: undefined as ComposerSurfaceProps | undefined }

// Stand in for the Tiptap surface: expose the wiring the variant drives.
vi.mock('@renderer/components/composer/ComposerSurface', () => ({
  default: (props: ComposerSurfaceProps) => {
    captured.surfaceProps = props
    return (
      <div>
        <div data-testid="surface-header">{props.headerContent}</div>
        <button type="button" aria-label="send" disabled={props.sendDisabled}>
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
    models: [{ providerId: 'google', apiModelId: 'veo-3.1-generate', name: 'Veo 3.1' }]
  })
}))

vi.mock('../../../CreationModelSelector', () => ({
  default: () => <div data-testid="creation-model-selector" />
}))

vi.mock('../../../hooks/useCreationComposerInputFiles', () => ({ useCreationComposerInputFiles: vi.fn() }))

// Imported after mocks are registered.
const { default: VideoComposer } = await import('../VideoComposer')

const multiModeSupport = {
  modes: {
    t2v: {
      supports: {
        resolution: { type: 'enum', options: ['720p', '1080p'], default: '720p' }
      }
    },
    keyframe: {
      mediaInputs: { firstFrame: true, lastFrame: true },
      supports: {
        resolution: { type: 'enum', options: ['720p'], default: '720p' }
      }
    }
  }
} as unknown as VideoGenerationSupport

function makeProps(overrides: Partial<React.ComponentProps<typeof VideoComposer>> = {}) {
  return {
    composerKey: 'draft-0',
    providerId: 'google',
    modelId: 'veo-3.1-generate',
    prompt: '',
    generating: false,
    support: multiModeSupport,
    mode: 't2v' as const,
    onModeChange: vi.fn(),
    params: {},
    onParamsChange: vi.fn(),
    onFirstFrameChange: vi.fn(),
    onLastFrameChange: vi.fn(),
    onPromptChange: vi.fn(),
    onGenerate: vi.fn(),
    onCancel: vi.fn(),
    onModelSelect: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  captured.surfaceProps = undefined
})

describe('VideoComposer', () => {
  it('renders registry-driven mode pills when the model declares more than one mode', () => {
    render(<VideoComposer {...makeProps()} />)
    expect(screen.getByText('paintings.video.mode_options.t2v')).toBeInTheDocument()
    expect(screen.getByText('paintings.video.mode_options.keyframe')).toBeInTheDocument()
  })

  it('hides mode pills for a single-mode model', () => {
    const singleMode = {
      modes: { t2v: { supports: {} } }
    } as unknown as VideoGenerationSupport
    render(<VideoComposer {...makeProps({ support: singleMode })} />)
    expect(screen.queryByText('paintings.video.mode_options.t2v')).not.toBeInTheDocument()
  })

  it('renders media placeholder slots per the active mode mediaInputs (none for t2v)', () => {
    render(<VideoComposer {...makeProps({ mode: 't2v' })} />)
    expect(captured.surfaceProps?.headerContent).toBeUndefined()
    expect(screen.queryByLabelText('paintings.video.first_frame')).not.toBeInTheDocument()
  })

  it('renders first/last frame placeholder slots for a keyframe mode', () => {
    render(<VideoComposer {...makeProps({ mode: 'keyframe' })} />)
    expect(captured.surfaceProps?.headerContent).toBeTruthy()
    expect(screen.getByLabelText('paintings.video.first_frame')).toBeInTheDocument()
    expect(screen.getByLabelText('paintings.video.last_frame')).toBeInTheDocument()
  })

  it('renders the params button from videoGenerationToFields output', () => {
    render(<VideoComposer {...makeProps()} />)
    expect(screen.getByLabelText(/common\.settings/)).toBeInTheDocument()
  })

  it('blocks send with an empty prompt and no first frame (requirePrompt defaults true)', () => {
    render(<VideoComposer {...makeProps()} />)
    expect(captured.surfaceProps?.sendDisabled).toBe(true)
  })

  it('allows send on the first frame alone (i2v without prompt)', () => {
    render(
      <VideoComposer {...makeProps({ mode: 'keyframe', firstFrame: { id: 'f1', name: 'f1', ext: 'png' } as never })} />
    )
    expect(captured.surfaceProps?.sendDisabled).toBe(false)
  })

  it('allows an empty-prompt send when the mode declares requirePrompt: false', () => {
    const noPromptSupport = {
      modes: { t2v: { requirePrompt: false, supports: {} } }
    } as unknown as VideoGenerationSupport
    render(<VideoComposer {...makeProps({ support: noPromptSupport })} />)
    expect(captured.surfaceProps?.sendDisabled).toBe(false)
  })

  it('opts out of the flat attachment pipeline (no exts, no drag-drop)', () => {
    render(<VideoComposer {...makeProps()} />)
    expect(captured.surfaceProps?.supportedExts).toEqual([])
    expect(captured.surfaceProps?.enableDragDrop).toBe(false)
  })
})
