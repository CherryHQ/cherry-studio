import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ImageGenerationConfigSchema } from '@shared/ai/imageGenerationConfig'

import { openAIImageSupport } from '../../../../../../../../packages/provider-registry/src/creators/imageCanvases'
import { ModelImageSettings } from '../ModelImageSettings'

vi.unmock('@cherrystudio/ui')

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  MockUseDataApiUtils.mockQueryData(
    '/providers/:providerId/models/:modelId*/image-generation-support',
    openAIImageSupport(true)
  )
})

describe('image model settings', () => {
  it('lets Seedream use multipart edits and keeps the protocol when resetting parameters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ModelImageSettings
        providerId="custom"
        modelId="Seedream"
        onChange={onChange}
        initialConfig={ImageGenerationConfigSchema.parse({ preset: 'seedream' })}
      />
    )
    const protocols = within(screen.getByRole('radiogroup', { name: 'Image API protocol' }))
    expect(protocols.getByRole('radio', { name: 'Ark (JSON)' })).toBeChecked()
    await user.click(protocols.getByRole('radio', { name: 'OpenAI Images (multipart edits)' }))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ preset: 'seedream', apiProtocol: 'openai' })
    await user.click(screen.getByRole('button', { name: 'Reset preset defaults' }))
    expect(protocols.getByRole('radio', { name: 'OpenAI Images (multipart edits)' })).toBeChecked()
    expect(onChange.mock.lastCall?.[0].apiProtocol).toBe('openai')
  })
  it('shows the effective Auto ratio before and after resetting a preset', async () => {
    const user = userEvent.setup()
    render(
      <ModelImageSettings
        providerId="openai"
        modelId="gpt-image-2.5-sunburst"
        onChange={vi.fn()}
        initialConfig={ImageGenerationConfigSchema.parse({ generate: { options: { aspectRatio: ['1:1', '16:9'] } } })}
      />
    )
    const ratios = within(screen.getByRole('group', { name: 'Aspect Ratio' }))
    expect(ratios.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(ratios.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(ratios.getByRole('button', { name: '1:1' }))
    expect(screen.getByText(/Expected 1024×1024/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reset preset defaults' }))
    expect(ratios.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/Expected 1024×1024/)).not.toBeInTheDocument()
  })

  it('renders a localized validation message instead of the shared diagnostic', async () => {
    await i18n.changeLanguage('zh-CN')
    render(
      <ModelImageSettings
        providerId="openai"
        modelId="gpt-image-2.5-sunburst"
        onChange={vi.fn()}
        initialConfig={ImageGenerationConfigSchema.parse({ generate: { defaults: { aspectRatio: 'bad-ratio' } } })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的正数比例，例如 16:9。')
    expect(screen.queryByText('Invalid aspect ratio')).not.toBeInTheDocument()
  })
})
