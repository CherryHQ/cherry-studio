import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BaseConfigItem } from '../../form/baseConfigItem'
import CreationParamsButton from '../CreationParamsButton'

// Keep t() returning raw keys — the summary assertions match option labels/values.
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../CreationParamsForm', () => ({
  default: () => <div data-testid="creation-params-form" />
}))

const imageItems: BaseConfigItem[] = [
  {
    type: 'select',
    key: 'size',
    title: 'paintings.image.size',
    options: [
      { label: '1024x1024', value: '1024x1024' },
      { label: '1536x1024', value: '1536x1024' }
    ],
    initialValue: '1024x1024'
  },
  {
    type: 'select',
    key: 'quality',
    title: 'paintings.quality',
    options: [{ label: 'high', value: 'high' }]
  }
]

const videoItems: BaseConfigItem[] = [
  {
    type: 'select',
    key: 'resolution',
    title: 'paintings.video.resolution',
    options: [
      { label: '720p', value: '720p' },
      { label: '1080p', value: '1080p' }
    ],
    initialValue: '720p'
  },
  {
    type: 'select',
    key: 'duration',
    title: 'paintings.video.duration',
    options: [
      { label: '5', value: '5' },
      { label: '10', value: '10' }
    ]
  },
  {
    type: 'slider',
    key: 'cfg',
    title: 'paintings.guidance_scale',
    min: 1,
    max: 10
  }
]

describe('CreationParamsButton', () => {
  it('renders nothing when the model declares no fields', () => {
    const { container } = render(<CreationParamsButton items={[]} params={{}} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('summarizes image-style params (size chip + selected option labels)', () => {
    render(<CreationParamsButton items={imageItems} params={{ quality: 'high' }} onChange={vi.fn()} />)
    const button = screen.getByRole('button')
    // size falls back to its registry default; quality reflects the explicit value.
    expect(button.getAttribute('aria-label')).toContain('1024')
    expect(button.getAttribute('aria-label')).toContain('high')
  })

  it('summarizes video-style params (resolution default + explicit duration + slider value)', () => {
    render(<CreationParamsButton items={videoItems} params={{ duration: '10', cfg: 7.5 }} onChange={vi.fn()} />)
    const label = screen.getByRole('button').getAttribute('aria-label') ?? ''
    expect(label).toContain('720p')
    expect(label).toContain('10')
    expect(label).toContain('7.5')
  })
})
