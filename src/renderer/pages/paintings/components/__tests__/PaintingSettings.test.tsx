import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    InfoTooltip: () => null
  }
})

const mockUseImageGenerationSupport = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: mockUseImageGenerationSupport
}))

const { default: PaintingSettings } = await import('../PaintingSettings')

const painting: PaintingData = {
  id: 'p1',
  providerId: 'silicon',
  model: 'flux.1-dev',
  mode: 'generate',
  prompt: '',
  files: [],
  params: { promptEnhancement: false }
}

describe('PaintingSettings switch row', () => {
  it('keeps prompt enhancement on one row: labeled switch to the right of its title', async () => {
    mockUseImageGenerationSupport.mockReturnValue({
      modes: {
        generate: {
          supports: {
            promptEnhancement: { type: 'switch', default: false }
          }
        }
      }
    })
    const onConfigChange = vi.fn()
    render(<PaintingSettings painting={painting} onConfigChange={onConfigChange} />)

    const title = screen.getByText('paintings.prompt_enhancement')
    const enhancementSwitch = screen.getByRole('switch', { name: 'paintings.prompt_enhancement' })
    // Stacking the control under the title would wrap it; same-row layout keeps them siblings.
    expect(enhancementSwitch.parentElement).toContainElement(title)
    expect(enhancementSwitch.parentElement).toHaveClass('justify-between')
    expect(enhancementSwitch).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(enhancementSwitch)
    expect(onConfigChange).toHaveBeenCalledWith({ params: { promptEnhancement: true } })
  })
})
