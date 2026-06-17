import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AssistantPresetIcon } from '../AssistantPresetIcon'
import type { AssistantCatalogPreset } from '../useAssistantPresetCatalog'

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

function renderPreset(preset: AssistantCatalogPreset) {
  return render(<AssistantPresetIcon preset={preset} />)
}

describe('AssistantPresetIcon', () => {
  it('renders an SVG when iconKey resolves to a model icon (claude)', () => {
    const { container } = renderPreset({
      name: 'Claude',
      iconKey: 'claude',
      emoji: '🟧'
    })
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders an SVG when iconKey resolves only via provider catalog (openai)', () => {
    const { container } = renderPreset({
      name: 'ChatGPT',
      iconKey: 'openai',
      emoji: '💬'
    })
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders an SVG when iconKey resolves only via provider catalog (deepseek)', () => {
    const { container } = renderPreset({
      name: 'DeepSeek',
      iconKey: 'deepseek',
      emoji: '🐋'
    })
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to emoji when iconKey is missing', () => {
    const { container, getByText } = renderPreset({
      name: 'Custom',
      emoji: '🤖'
    })
    expect(container.querySelector('svg')).toBeNull()
    expect(getByText('🤖')).toBeTruthy()
  })
})
