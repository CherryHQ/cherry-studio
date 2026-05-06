import type { MiniApp } from '@shared/data/types/miniApp'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppSettings from '../MiniAppSettings'

const mocks = vi.hoisted(() => {
  const stubApp = (id: string): MiniApp => ({
    appId: id,
    name: id,
    url: `https://${id}.example.com`,
    presetMiniappId: id as MiniApp['presetMiniappId'],
    status: 'enabled',
    orderKey: 'a0'
  })
  return {
    miniapps: [stubApp('a'), stubApp('b')],
    disabled: [stubApp('c'), stubApp('d')],
    updateMiniApps: vi.fn(),
    updateDisabledMiniApps: vi.fn()
  }
})

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniapps: mocks.miniapps,
    disabled: mocks.disabled,
    updateMiniApps: mocks.updateMiniApps,
    updateDisabledMiniApps: mocks.updateDisabledMiniApps
  })
}))

// Mock @cherrystudio/ui Button to a plain <button> so onClick is unambiguous in tests.
// Other primitives (Switch, Tooltip) are passthrough no-ops since this suite only exercises Button clicks.
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
  Switch: () => null,
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  // oxlint-disable-next-line no-unused-vars
  usePreference: (_key: string) => [undefined, vi.fn()]
}))

vi.mock('../MiniAppIconsManager', () => ({
  default: () => null
}))

vi.mock('@renderer/pages/settings', () => ({
  SettingTitle: ({ children, ...rest }: React.PropsWithChildren) => <div {...rest}>{children}</div>,
  SettingDivider: () => <hr />,
  SettingDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SettingRowTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/components/Selector', () => ({ default: () => null }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MiniAppSettings', () => {
  beforeEach(() => {
    mocks.updateMiniApps.mockClear()
    mocks.updateDisabledMiniApps.mockClear()
  })

  it('persists swap to DataApi when the swap button is clicked', async () => {
    render(<MiniAppSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'common.swap' }))

    expect(mocks.updateMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateMiniApps).toHaveBeenCalledWith(mocks.disabled)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledWith(mocks.miniapps)
  })

  it('persists reset to DataApi when the reset button is clicked', async () => {
    render(<MiniAppSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }))

    expect(mocks.updateMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateMiniApps).toHaveBeenCalledWith(mocks.miniapps)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledWith([])
  })

  it('swap does not clear the disabled list (regression: distinct from reset)', () => {
    render(<MiniAppSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'common.swap' }))

    const [arg] = mocks.updateDisabledMiniApps.mock.calls[0]
    expect(arg).toEqual(mocks.miniapps)
    expect(arg).not.toEqual([])
  })
})
