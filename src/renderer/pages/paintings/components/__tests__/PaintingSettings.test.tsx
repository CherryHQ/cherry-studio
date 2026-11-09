import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelListSchema } from '@cherrystudio/provider-registry'
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

describe('PaintingSettings output format note', () => {
  it('does not show a format claim without registry support', () => {
    renderSettings()
    expect(screen.queryByTestId('painting-output-format-note')).not.toBeInTheDocument()
  })

  it('lists the model output format options', () => {
    const support = ModelListSchema.parse(catalog).models.find(
      (model) => model.id === 'gpt-image-2-6-flare'
    )?.imageGeneration
    if (!support?.modes.generate) throw new Error('Missing generation support')
    support.modes.generate.supports = { outputFormat: { type: 'enum', options: ['png', 'jpeg', 'webp'] } }
    vi.mocked(useImageGenerationSupport).mockReturnValue(support)
    renderSettings()
    expect(screen.getByTestId('painting-output-format-note')).toHaveTextContent(
      'Supported output formats: PNG, JPEG, WEBP.'
    )
  })

  it('explains provider-selected output when no format control exists', () => {
    const support = ModelListSchema.parse(catalog).models.find(
      (model) => model.id === 'gpt-image-2-6-flare'
    )?.imageGeneration
    if (!support?.modes.generate) throw new Error('Missing generation support')
    support.modes.generate.supports = {}
    vi.mocked(useImageGenerationSupport).mockReturnValue(support)
    renderSettings()
    expect(screen.getByTestId('painting-output-format-note')).toHaveTextContent(
      'Output format is chosen by the provider'
    )
    expect(screen.getByTestId('painting-output-format-note')).not.toHaveTextContent('Supported output formats:')
  })
})

it.each(['image-01', 'image-01-live'])(
  'does not describe MiniMax %s response delivery as an image encoding',
  (modelId) => {
    const support = ModelListSchema.parse(catalog).models.find((model) => model.id === modelId)?.imageGeneration
    if (!support) throw new Error('Missing real MiniMax catalog support')
    vi.mocked(useImageGenerationSupport).mockReturnValue(support)
    renderWithI18n(
      <PaintingSettings painting={{ ...painting, providerId: 'minimax', model: modelId }} onConfigChange={vi.fn()} />
    )
    const note = screen.getByTestId('painting-output-format-note')
    expect(note).toHaveTextContent('Output format is chosen by the provider')
    expect(note).not.toHaveTextContent('Supported output formats:')
    expect(note).not.toHaveTextContent('BASE64')
  }
)
