import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelListSchema } from '@cherrystudio/provider-registry'
import { useProviderById } from '@renderer/hooks/useProvider'
import en from '@renderer/i18n/locales/en-us.json'

import catalog from '../../../../../../packages/provider-registry/data/models.json'
import { useImageGenerationSupport } from '../../hooks/useImageGenerationSupport'
import type { PaintingData } from '../../model/types/paintingData'
import PaintingSettings from '../PaintingSettings'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
const renderWithI18n = (ui: ReactNode) =>
  render(ui, { wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider> })

vi.unmock('react-i18next')

vi.mock('@renderer/hooks/useProvider', () => ({ useProviderById: vi.fn() }))

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

beforeEach(() => {
  vi.mocked(useImageGenerationSupport).mockReturnValue(undefined)
  vi.mocked(useProviderById).mockReturnValue({
    provider: { id: 'dashscope', settings: {} },
    isLoading: false,
    error: undefined
  } as ReturnType<typeof useProviderById>)
})

describe('PaintingSettings request timeout', () => {
  it('commits the entered seconds as milliseconds', () => {
    const { onConfigChange, input } = renderSettings()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)

    expect(onConfigChange).toHaveBeenCalledWith({ requestTimeoutMs: 30_000 })
  })

  it('hides the override where the transport does not apply it', () => {
    vi.mocked(useProviderById).mockReturnValue({ provider: { id: 'dmxapi', settings: {} } } as ReturnType<
      typeof useProviderById
    >)
    renderWithI18n(<PaintingSettings painting={{ ...painting, providerId: 'dmxapi' }} onConfigChange={vi.fn()} />)

    expect(screen.queryByLabelText('Request timeout (seconds)')).not.toBeInTheDocument()
  })

  it('shows the saved timeout when a duplicated dashscope provider loads', () => {
    const id = '00000000-0000-4000-8000-000000000002'
    vi.mocked(useProviderById).mockReturnValue({ provider: undefined, isLoading: true, error: undefined } as ReturnType<
      typeof useProviderById
    >)
    const draft = { ...painting, providerId: id }
    const { rerender } = renderWithI18n(<PaintingSettings painting={draft} onConfigChange={vi.fn()} />)
    expect(screen.queryByLabelText('Request timeout (seconds)')).not.toBeInTheDocument()
    vi.mocked(useProviderById).mockReturnValue({
      provider: { id, presetProviderId: 'dashscope', settings: { imageRequestTimeoutMs: 900_000 } }
    } as ReturnType<typeof useProviderById>)
    rerender(<PaintingSettings painting={draft} onConfigChange={vi.fn()} />)
    expect(screen.getByLabelText('Request timeout (seconds)')).toBeInTheDocument()
    expect(screen.getByText('Effective timeout: 900 seconds')).toBeInTheDocument()
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

it.each([
  [900_000, undefined, '900'],
  [900_000, 30_000, '30'],
  [undefined, undefined, '600'],
  [10_001, undefined, '10.001']
])('shows the effective timeout', (saved, draft, seconds) => {
  vi.mocked(useProviderById).mockReturnValue({
    provider: { id: 'dashscope', settings: { imageRequestTimeoutMs: saved } },
    isLoading: false,
    error: undefined
  } as ReturnType<typeof useProviderById>)
  renderSettings({ requestTimeoutMs: draft })
  expect(screen.getByText(`Effective timeout: ${seconds} seconds`)).toBeInTheDocument()
})

it('updates the helper when provider data arrives without changing the draft', () => {
  vi.mocked(useProviderById).mockReturnValue({ provider: undefined, isLoading: true, error: undefined } as ReturnType<
    typeof useProviderById
  >)
  const onConfigChange = vi.fn()
  const { rerender } = renderWithI18n(<PaintingSettings painting={painting} onConfigChange={onConfigChange} />)
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  vi.mocked(useProviderById).mockReturnValue({
    provider: { id: 'dashscope', settings: { imageRequestTimeoutMs: 900_000 } },
    isLoading: false,
    error: undefined
  } as ReturnType<typeof useProviderById>)
  rerender(<PaintingSettings painting={painting} onConfigChange={onConfigChange} />)
  expect(screen.getByText('Effective timeout: 900 seconds')).toBeInTheDocument()
  expect(onConfigChange).not.toHaveBeenCalled()
})
