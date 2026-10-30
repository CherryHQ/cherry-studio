import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import PaintingSettings from '../PaintingSettings'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: () => undefined
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
  render(<PaintingSettings painting={{ ...painting, ...overrides }} onConfigChange={onConfigChange} />)
  return { onConfigChange, input: screen.getByLabelText('paintings.request_timeout') }
}

describe('PaintingSettings request timeout', () => {
  it('commits the entered seconds as milliseconds', () => {
    const { onConfigChange, input } = renderSettings()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.blur(input)

    expect(onConfigChange).toHaveBeenCalledWith({ requestTimeoutMs: 30_000 })
  })

  it('hides the override where the transport does not apply it', () => {
    render(<PaintingSettings painting={{ ...painting, providerId: 'dmxapi' }} onConfigChange={vi.fn()} />)

    expect(screen.queryByLabelText('paintings.request_timeout')).not.toBeInTheDocument()
  })

  it('clears the override when the field is emptied', () => {
    const { onConfigChange, input } = renderSettings({ requestTimeoutMs: 30_000 })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(onConfigChange).toHaveBeenCalledWith({ requestTimeoutMs: undefined })
  })
})
