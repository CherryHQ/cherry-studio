import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { type ComponentProps, useMemo } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import {
  ComposerToolProvider,
  useComposerToolProviderDispatch,
  useComposerToolProviderLaunchers
} from '@renderer/components/composer/tools/ComposerToolProvider'
import type { QuickPanelContextType } from '@renderer/components/QuickPanel'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import enUS from '@renderer/i18n/locales/en-us.json'
import { type Assistant, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

vi.unmock('@data/hooks/useDataApi')

const panel = vi.hoisted(() => ({ isVisible: false, symbol: '', updateList: vi.fn(), open: vi.fn() }))
vi.mock('@renderer/components/QuickPanel', () => ({ useQuickPanel: () => panel }))

import generateImageTool from '../generateImageTool'

const i18n = createInstance()
await i18n.init({ lng: 'en-US', keySeparator: false, resources: { 'en-US': { translation: enUS } } })

const support = {
  modes: { generate: { supports: { size: { type: 'enum', options: ['1792x1024', '1024x1792'] } } } }
}
let assistant: Assistant

function RuntimeWithLaunchers({ mounted = true }: { mounted?: boolean }) {
  const { toolsRegistry } = useComposerToolProviderDispatch()
  const { getLaunchers } = useComposerToolProviderLaunchers()
  const launcher = useMemo(
    () => ({
      registerLaunchers: (entries: ComposerToolLauncher[]) => toolsRegistry.registerLaunchers('generate_image', entries)
    }),
    [toolsRegistry]
  )
  const Runtime = generateImageTool.composer!.runtime!
  return (
    <>
      {mounted && <Runtime context={{ assistant, launcher } as ComponentProps<typeof Runtime>['context']} />}
      {getLaunchers().map((entry) => (
        <button
          key={entry.id}
          type="button"
          disabled={entry.disabled}
          aria-pressed={entry.active}
          title={typeof entry.disabledReason === 'string' ? entry.disabledReason : undefined}
          onClick={() => entry.action?.({ quickPanel: panel as unknown as QuickPanelContextType, source: 'popover' })}>
          {entry.label}
        </button>
      ))}
    </>
  )
}

function renderRuntime() {
  const { Wrapper } = createSWRTestWrapper()
  const tree = (mounted = true) => (
    <I18nextProvider i18n={i18n}>
      <Wrapper>
        {['active composer', 'deferred composer'].map((name) => (
          <section key={name} aria-label={name}>
            <ComposerToolProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
              <RuntimeWithLaunchers mounted={mounted} />
            </ComposerToolProvider>
          </section>
        ))}
      </Wrapper>
    </I18nextProvider>
  )
  const view = render(tree())
  return { ...view, removeRuntimes: () => view.rerender(tree(false)) }
}

async function expectEnabledGeometry() {
  for (const composer of screen.getAllByRole('region')) {
    const picker = await within(composer).findByRole('button', { name: 'Default image geometry' })
    await waitFor(() => expect(picker).toBeEnabled())
    expect(picker).toHaveAttribute('aria-pressed', 'true')
    expect(within(composer).getAllByRole('button')).toHaveLength(2)
  }
}

describe('generateImageTool', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', 'openai::dall-e-3')
    panel.open.mockClear()
    assistant = {
      id: 'a1',
      name: 'Assistant',
      prompt: '',
      emoji: '😀',
      description: '',
      settings: { ...DEFAULT_ASSISTANT_SETTINGS, enableGenerateImage: false },
      modelId: null,
      modelName: null,
      groupId: null,
      orderKey: 'a0',
      mcpServerIds: [],
      knowledgeBaseIds: [],
      createdAt: '2026-11-08T00:00:00Z',
      updatedAt: '2026-11-08T00:00:00Z'
    }
    mockDataApiService.get.mockImplementation(async (path) => {
      if (path === '/assistants/a1') return structuredClone(assistant)
      if (path.endsWith('/image-generation-support')) return support
      if (path === '/providers') return []
      throw new Error(`Unexpected GET ${path}`)
    })
    mockDataApiService.patch.mockImplementation(async (path, options) => {
      if (path !== '/assistants/a1') throw new Error(`Unexpected PATCH ${path}`)
      assistant = { ...assistant, settings: { ...assistant.settings, ...options.body.settings } }
      return structuredClone(assistant)
    })
  })

  it('enables geometry and lists presets after the toggle PATCH, across mounted composers', async () => {
    const user = userEvent.setup()
    const { removeRuntimes } = renderRuntime()
    const active = within(screen.getByRole('region', { name: 'active composer' }))
    const toggle = await active.findByRole('button', { name: 'Generate image' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'))
    expect(mockDataApiService.patch).toHaveBeenCalledWith('/assistants/a1', {
      body: { settings: { enableGenerateImage: true } },
      query: undefined
    })
    await expectEnabledGeometry()
    await user.click(active.getByRole('button', { name: 'Default image geometry' }))
    expect(panel.open.mock.lastCall![0].list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'size:1792x1024', label: '1792×1024' }),
        expect.objectContaining({ id: 'size:1024x1792', label: '1024×1792' })
      ])
    )
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'))
    for (const composer of screen.getAllByRole('region')) {
      expect(within(composer).getByRole('button', { name: 'Default image geometry' })).toBeDisabled()
    }
    removeRuntimes()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('refreshes both launchers for a committed assistant read-model change', async () => {
    renderRuntime()
    await screen.findAllByRole('button', { name: 'Generate image' })
    assistant = { ...assistant, settings: { ...assistant.settings, enableGenerateImage: true } }
    act(() =>
      MockDataApiUtils.emitDataChange([
        { endpoint: '/assistants', kind: 'membership', entityIds: ['a1'] },
        { endpoint: '/assistants/:id', entityIds: ['a1'] }
      ])
    )
    await expectEnabledGeometry()
    expect(mockDataApiService.patch).not.toHaveBeenCalled()
  })

  it('keeps the toggle disabled with its existing hint when no painting model is configured', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.paintings.default_model_id', null)
    renderRuntime()
    for (const toggle of await screen.findAllByRole('button', { name: 'Generate image' })) {
      expect(toggle).toBeDisabled()
      expect(toggle).toHaveAttribute('title', enUS['chat.input.generate_image_no_model'])
      await user.click(toggle)
    }
    expect(mockDataApiService.patch).not.toHaveBeenCalled()
    for (const picker of screen.getAllByRole('button', { name: 'Default image geometry' })) {
      expect(picker).toBeDisabled()
      expect(picker).toHaveAttribute('title', enUS['chat.input.generate_image_no_model'])
    }
  })
})
