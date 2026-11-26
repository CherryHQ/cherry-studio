import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelListSchema } from '@cherrystudio/provider-registry'
import { prefetch } from '@data/hooks/useDataApi'
import en from '@renderer/i18n/locales/en-us.json'
import { validateSeedreamImageParams } from '@shared/ai/seedreamImageContract'

import catalog from '../../../../../../packages/provider-registry/data/models.json'
import type * as PaintingFields from '../../form/PaintingFieldRenderer'
import type { PaintingFieldRendererProps } from '../../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../../hooks/useImageGenerationSupport'
import { usePaintingModelSwitch } from '../../hooks/usePaintingModelSwitch'
import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { PaintingData } from '../../model/types/paintingData'
import PaintingSettings from '../PaintingSettings'

const fieldUpdates = vi.hoisted(() => new Map<string, PaintingFieldRendererProps['onChange']>())
const generateRequest = vi.hoisted(() => vi.fn<(input: unknown) => Promise<never[]>>(async () => []))
vi.mock('../../model/generatePainting', () => ({ generatePainting: generateRequest }))
vi.mock('../../utils/checkProviderEnabled', () => ({ checkProviderEnabled: vi.fn(async () => 'key') }))
vi.mock('../../form/PaintingFieldRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof PaintingFields>()
  return {
    PaintingFieldRenderer: (props: PaintingFieldRendererProps) => {
      fieldUpdates.set(props.item.key, props.onChange)
      return <actual.PaintingFieldRenderer {...props} />
    }
  }
})
const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
const renderWithI18n = (ui: ReactNode) =>
  render(ui, { wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider> })

vi.unmock('react-i18next')

vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: vi.fn()
}))

const painting = {
  id: 'painting-1',
  providerId: 'dashscope',
  mode: 'generate',
  prompt: 'a fox',
  files: []
} satisfies PaintingData

function renderSettings(overrides: Partial<PaintingData> = {}) {
  const onConfigChange = vi.fn()
  renderWithI18n(<PaintingSettings painting={{ ...painting, ...overrides }} onConfigChange={onConfigChange} />)
  return { onConfigChange, input: screen.getByLabelText('Request timeout (seconds)') }
}

beforeEach(() => vi.mocked(useImageGenerationSupport).mockReturnValue(undefined))

describe('PaintingSettings request timeout', () => {
  it('commits the entered seconds as milliseconds', () => {
    const { onConfigChange, input } = renderSettings()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)

    expect(onConfigChange).toHaveBeenCalledWith({ requestTimeoutMs: 30_000 })
  })

  it('hides the override where the transport does not apply it', () => {
    renderWithI18n(<PaintingSettings painting={{ ...painting, providerId: 'dmxapi' }} onConfigChange={vi.fn()} />)

    expect(screen.queryByLabelText('Request timeout (seconds)')).not.toBeInTheDocument()
  })

  it('clears the override when the field is emptied', () => {
    const { onConfigChange, input } = renderSettings({ requestTimeoutMs: 30_000 })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(onConfigChange).toHaveBeenCalledWith({ requestTimeoutMs: undefined })
  })
})

it('hides animation settings when reference images change generation into editing', () => {
  const support = ModelListSchema.parse(catalog).models.find(
    (model) => model.id === 'gpt-image-2-6-flare'
  )?.imageGeneration
  if (!support?.modes.edit) throw new Error('Missing edit support')
  support.modes.edit.supports = {
    complexity: { type: 'enum', options: ['low', 'medium', 'high'] },
    outputFormat: { type: 'enum', options: ['png', 'jpeg', 'webp'] }
  }
  vi.mocked(useImageGenerationSupport).mockReturnValue(support)
  const draft = { ...painting, params: { outputFormat: 'gif' } }
  const { rerender } = renderWithI18n(
    <PaintingSettings painting={draft} inputImageCount={0} onConfigChange={vi.fn()} />
  )
  expect(screen.getByRole('spinbutton', { name: 'Frame count' })).toBeInTheDocument()
  rerender(<PaintingSettings painting={draft} inputImageCount={1} onConfigChange={vi.fn()} />)
  expect(screen.queryByRole('spinbutton', { name: 'Frame count' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Scene complexity')).toBeInTheDocument()
})

it('atomically enables the transparent preset, preserves it on edits, and unlocks on disable', async () => {
  const changes = vi.fn()
  vi.mocked(useImageGenerationSupport).mockReturnValue({
    modes: {
      generate: {
        supports: {
          outputFormat: { type: 'enum', options: ['jpeg', 'png'] },
          background: { type: 'enum', options: ['auto', 'transparent'] },
          seed: { type: 'range', min: 0, max: 100 }
        }
      }
    }
  })
  function Harness() {
    const [draft, setDraft] = useState<PaintingData>({
      ...painting,
      model: 'doubao-seedream-5-5',
      params: { outputFormat: 'jpeg', background: 'auto', seed: 1 }
    })
    return (
      <>
        <PaintingSettings
          painting={draft}
          onConfigChange={(updates) => {
            changes(updates)
            setDraft({ ...draft, ...updates })
          }}
        />
        <button
          type="button"
          onClick={() =>
            void canonicalGenerate({
              painting: draft,
              provider: { id: 'doubao', name: 'Doubao', isEnabled: true, apiHost: '', getApiKey: async () => 'key' },
              tab: 'default',
              abortController: new AbortController()
            })
          }>
          Submit
        </button>
      </>
    )
  }
  renderWithI18n(<Harness />)
  fireEvent.click(screen.getByRole('switch', { name: 'Transparent asset' }))
  expect(changes).toHaveBeenLastCalledWith({ params: { outputFormat: 'png', background: 'transparent', seed: 1 } })
  expect(screen.queryByLabelText('Output format')).not.toBeInTheDocument()
  const seed = screen.getByRole('spinbutton', { name: /seed/i })
  fireEvent.focus(seed)
  fireEvent.change(seed, { target: { value: '2' } })
  fireEvent.blur(seed)
  expect(changes).toHaveBeenLastCalledWith({ params: { outputFormat: 'png', background: 'transparent', seed: 2 } })
  act(() => fieldUpdates.get('seed')!({ background: 'auto', outputFormat: 'jpeg' }))
  expect(changes).toHaveBeenLastCalledWith({ params: { outputFormat: 'png', background: 'transparent', seed: 2 } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() =>
    expect(generateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        paramValues: expect.objectContaining({ outputFormat: 'png', background: 'transparent' })
      })
    )
  )
  fireEvent.click(screen.getByRole('switch', { name: 'Transparent asset' }))
  expect(changes).toHaveBeenLastCalledWith({ params: { outputFormat: 'png', background: 'auto', seed: 2 } })
  act(() => fieldUpdates.get('outputFormat')!({ outputFormat: 'jpeg' }))
  expect(changes).toHaveBeenLastCalledWith({ params: { outputFormat: 'jpeg', background: 'auto', seed: 2 } })
})

it('does not offer the preset for Seedream Lite', () => {
  renderWithI18n(
    <PaintingSettings painting={{ ...painting, model: 'doubao-seedream-5-0-lite' }} onConfigChange={vi.fn()} />
  )
  expect(screen.queryByRole('switch', { name: 'Transparent asset' })).not.toBeInTheDocument()
})

describe('Seedream size source switching', () => {
  it('normalizes carried custom dimensions when settings open after a same-provider model switch to Seedream', async () => {
    const models = ModelListSchema.parse(catalog).models
    const oldSupport = models.find((model) => model.id === 'cogview-4')?.imageGeneration
    const newSupport = models.find((model) => model.id === 'doubao-seedream-5-5')?.imageGeneration
    if (!oldSupport || !newSupport) throw new Error('Missing model support')
    MockUseDataApiUtils.mockQueryData('/models', [])
    vi.mocked(prefetch).mockResolvedValueOnce(oldSupport).mockResolvedValueOnce(newSupport)
    vi.mocked(useImageGenerationSupport).mockReturnValue(newSupport)
    let latest!: PaintingData
    function Harness() {
      const [draft, setDraft] = useState<PaintingData>({
        ...painting,
        model: 'cogview-4',
        params: { size: 'custom', customSize_width: 1024, customSize_height: 1024 }
      })
      const [open, setOpen] = useState(false)
      latest = draft
      const update = (updates: Partial<PaintingData>) => setDraft((previous) => ({ ...previous, ...updates }))
      const switchModel = usePaintingModelSwitch({
        painting: draft,
        onPaintingChange: update,
        ensureProviderCatalog: async () => []
      })
      return (
        <>
          <button onClick={() => void switchModel({ providerId: draft.providerId, modelId: 'doubao-seedream-5-5' })}>
            Select Seedream
          </button>
          <button onClick={() => setOpen(true)}>Open settings</button>
          {open && <PaintingSettings painting={draft} onConfigChange={update} />}
        </>
      )
    }
    renderWithI18n(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Seedream' }))
    await waitFor(() => expect(latest.model).toBe('doubao-seedream-5-5'))
    expect(latest.params).toMatchObject({ imageResolution: '1K', customSize_width: 1024, customSize_height: 1024 })
    expect(validateSeedreamImageParams(latest.params!)).toBe('size')
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(validateSeedreamImageParams(latest.params!)).toBeUndefined())
    expect(latest.params).toMatchObject({ imageResolution: '1K' })
    expect(latest.params).not.toHaveProperty('customSize_width')
    expect(latest.params).not.toHaveProperty('customSize_height')
    expect(latest.params).not.toHaveProperty('size')
  })

  function renderSizeSettings(params: Record<string, unknown>) {
    vi.mocked(useImageGenerationSupport).mockReturnValue({
      modes: {
        generate: {
          supports: {
            imageResolution: { type: 'enum', options: ['1K', '1.5K', '2K'] },
            customSize: { type: 'size', pairedEnumKey: 'imageResolution', minSide: 240, maxSide: 8601 }
          }
        }
      }
    })
    let latest = params
    function Harness() {
      const [draft, setDraft] = useState<PaintingData>({ ...painting, model: 'doubao-seedream-5-5', params })
      return (
        <PaintingSettings
          painting={draft}
          onConfigChange={(updates) => {
            latest = updates.params ?? latest
            setDraft((previous) => ({ ...previous, ...updates }))
          }}
        />
      )
    }
    renderWithI18n(<Harness />)
    return () => latest
  }

  it('clears custom dimensions and size atomically when switching to 1K', () => {
    const params = renderSizeSettings({ imageResolution: '1K' })
    fireEvent.click(screen.getByRole('button', { name: /custom/i }))
    for (const name of ['Width', 'Height']) {
      const input = screen.getByRole('spinbutton', { name })
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '1024' } })
      fireEvent.blur(input)
    }
    expect(params().customSize_width).toBe(1024)
    expect(params().customSize_height).toBe(1024)
    fireEvent.click(screen.getByRole('button', { name: '1K' }))
    expect(params()).toEqual({ imageResolution: '1K' })
    expect(validateSeedreamImageParams(params())).toBeUndefined()
  })

  it('replaces the tier with custom dimensions without conflicting size sources', () => {
    const params = renderSizeSettings({ imageResolution: '1K' })
    fireEvent.click(screen.getByRole('button', { name: /custom/i }))
    for (const name of ['Width', 'Height']) {
      const input = screen.getByRole('spinbutton', { name })
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '1024' } })
      fireEvent.blur(input)
    }
    expect(params().imageResolution).not.toBe('1K')
    expect(params().size).toBeUndefined()
    expect(params().customSize_width).toBe(1024)
    expect(params().customSize_height).toBe(1024)
    expect(validateSeedreamImageParams(params())).toBeUndefined()
  })

  it.each(['custom', '1024x1024'])(
    'normalizes directly supplied tier params with leftover size %s on mount',
    async (size) => {
      const params = renderSizeSettings({
        imageResolution: '1K',
        size,
        customSize_width: 1024,
        customSize_height: 1024
      })
      await waitFor(() => expect(params()).toEqual({ imageResolution: '1K' }))
      expect(validateSeedreamImageParams(params())).toBeUndefined()
    }
  )
})
