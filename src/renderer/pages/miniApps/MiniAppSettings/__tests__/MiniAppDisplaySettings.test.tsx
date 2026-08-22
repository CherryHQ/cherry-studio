// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppDisplaySettings from '../MiniAppDisplaySettings'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

vi.mock('@data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return MockUsePreference
})

vi.mock('@renderer/components/Selector', () => ({
  default: () => <div />
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { info: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MiniAppDisplaySettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('persists a mini-app tab icon size between 20px and 30px', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.tab_icon_size', 25)
    render(<MiniAppDisplaySettings />)

    const slider = screen.getByRole('slider', { name: 'settings.miniApps.tab_icon.title' })
    const hookIndex = MockUsePreference.usePreference.mock.calls.findIndex(
      ([key]) => key === 'feature.mini_app.tab_icon_size'
    )
    const setTabIconSize = MockUsePreference.usePreference.mock.results[hookIndex].value[1]

    expect(slider).toHaveAttribute('aria-valuemin', '20')
    expect(slider).toHaveAttribute('aria-valuemax', '30')
    expect(slider).toHaveAttribute('aria-valuenow', '25')
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(setTabIconSize).toHaveBeenCalledWith(26)
  })
})
