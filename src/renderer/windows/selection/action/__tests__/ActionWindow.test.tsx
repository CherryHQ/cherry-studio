import type * as CherryStudioUi from '@cherrystudio/ui'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { render } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActionWindow from '../ActionWindow'

const { opacityPreference, platform } = vi.hoisted(() => ({
  opacityPreference: { value: 100 },
  platform: { isMac: false }
}))

const action = {
  id: 'test-action',
  name: 'Test action',
  icon: 'test-icon',
  isBuiltIn: false
} as SelectionActionItem

vi.mock('@renderer/components/selection/SelectionActionIcon', () => ({
  default: ({ size }: { size: number }) => <span data-testid="action-icon" data-size={size} />
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Pick<typeof CherryStudioUi, 'Slider'>>()

  return {
    Button: ({ children, ...props }: PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Slider: actual.Slider,
    Tooltip: ({ children }: PropsWithChildren) => children
  }
})

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.selection.action_window_opacity') return [opacityPreference.value]
    return [false]
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => action
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))

vi.mock('../components/ActionGeneral', () => ({ default: () => null }))
vi.mock('../components/ActionTranslate', () => ({ default: () => null }))

describe('ActionWindow surface', () => {
  beforeEach(() => {
    opacityPreference.value = 100
    platform.isMac = false
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('keeps applying the configured opacity below 100%', () => {
    opacityPreference.value = 60

    const { container } = render(<ActionWindow />)

    expect(container.firstElementChild).toHaveStyle({ opacity: '0.6' })
  })
})
