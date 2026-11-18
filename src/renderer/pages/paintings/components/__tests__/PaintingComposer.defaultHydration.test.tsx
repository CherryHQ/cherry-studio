import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { type ReactNode, useState } from 'react'
import { expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurface'
import type { ApiPath, ResponseForPath } from '@shared/data/api/paths'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { usePaintingInitialDraft } from '../../hooks/usePaintingInitialDraft'
import { createDefaultPainting, type PaintingDraftDefaults } from '../../model/paintingPipeline'
import PaintingComposer from '../PaintingComposer'

vi.unmock('@cherrystudio/ui')

// Keep the real composer toolbar and selector while excluding Tiptap's unrelated editor lifecycle.
vi.mock('@renderer/components/composer/ComposerSurface', () => ({
  default: (props: ComposerSurfaceProps) => <>{props.renderLeftControls?.(undefined)}</>
}))

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolDerivedStateProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolRuntimeHost: () => null,
  useComposerToolState: () => ({ files: [], isExpanded: false }),
  useComposerToolDispatch: () => ({ setFiles: vi.fn(), setIsExpanded: vi.fn() }),
  useComposerToolLauncherActions: () => ({ getLaunchers: () => [], dispatchLauncher: vi.fn() }),
  useComposerToolLauncherVersion: () => 0,
  useComposerTokenReconcile: () => vi.fn()
}))

vi.mock('@renderer/components/composer/variants/shared/ComposerControlScaffolding', () => ({
  COMPOSER_ICON_ONLY_LABEL_CLASS: 'sr-only',
  COMPOSER_ICON_ONLY_SELECTOR_BUTTON_CLASS: 'w-8 justify-center px-0',
  COMPOSER_SELECTOR_BUTTON_CLASS: '',
  ComposerToolbarControls: ({
    renderContextControls
  }: {
    renderContextControls: (options: { side: 'top'; iconOnly: boolean }) => ReactNode
  }) => <>{renderContextControls({ side: 'top', iconOnly: false })}</>
}))

// jsdom has no viewport measurements; retain the real selector's rows and filtering.
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: unknown[]
    children: (item: unknown, index: number) => ReactNode
  }) => list.map(children)
}))

vi.mock('../../hooks/useImageGenerationSupport', () => ({ useImageGenerationSupport: () => undefined }))
vi.mock('../../hooks/usePaintingComposerInputFiles', () => ({
  usePaintingComposerInputFiles: () => ({ materializeInputs: vi.fn() })
}))

function Draft({ defaults }: { defaults: PaintingDraftDefaults }) {
  const [painting, setPainting] = useState(() => createDefaultPainting({ providerId: 'zhipu' }))
  usePaintingInitialDraft({ currentPainting: painting, draftDefaults: defaults, setCurrentPainting: setPainting })

  return (
    <PaintingComposer
      painting={painting}
      generating={false}
      submitting={false}
      onPromptChange={(prompt) => setPainting((current) => ({ ...current, prompt }))}
      targets={painting.model ? [{ providerId: painting.providerId, modelId: painting.model }] : []}
      onTargetsSelect={([selected]) =>
        selected && setPainting((current) => ({ ...current, providerId: selected.providerId, model: selected.modelId }))
      }
      onConfigChange={(updates) => setPainting((current) => ({ ...current, ...updates }))}
      onGenerate={() => undefined}
      onCancel={() => undefined}
    />
  )
}

it('keeps an open model picker usable when late defaults hydrate the untouched draft', async () => {
  await i18n.changeLanguage('en-us')
  const user = userEvent.setup()
  const models: Model[] = ['Default Image', 'Alternate Image'].map((name, index) => ({
    id: createUniqueModelId('openai', `image-${index}`),
    providerId: 'openai',
    apiModelId: `image-${index}`,
    name,
    capabilities: ['image-generation'],
    endpointTypes: ['openai-image-generation'],
    supportsStreaming: false,
    isEnabled: true,
    isHidden: false
  }))
  const providers: Provider[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      isEnabled: true,
      authType: 'api-key',
      apiKeys: [],
      settings: {},
      reportsActualCost: false
    }
  ]
  const refetch = vi.fn().mockResolvedValue(undefined)

  await mockUseQuery.withImplementation(
    <TPath extends ApiPath>(path: TPath) => ({
      data: (path === '/models' ? models : path === '/providers' ? providers : []) as ResponseForPath<TPath, 'GET'>,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch,
      mutate: vi.fn()
    }),
    async () => {
      const view = render(<Draft defaults={{ providerId: 'zhipu' }} />)
      await user.click(screen.getByRole('button', { name: /Select Model/i }))
      const picker = await screen.findByRole('dialog')
      const search = within(picker).getByRole('textbox')
      await user.type(search, 'Image')
      expect(await within(picker).findByRole('option', { name: /Alternate Image/ })).toBeVisible()

      view.rerender(<Draft defaults={{ providerId: 'openai', modelId: 'image-0' }} />)

      expect(await screen.findByRole('button', { name: /Default Image/ })).toBeVisible()
      expect(picker).toBeVisible()
      expect(search).toHaveValue('Image')
      await user.clear(search)
      await user.type(search, 'Alternate')
      await user.click(await within(picker).findByRole('option', { name: /Alternate Image/ }))
      expect(await screen.findByRole('button', { name: /Alternate Image/ })).toBeVisible()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )
})
