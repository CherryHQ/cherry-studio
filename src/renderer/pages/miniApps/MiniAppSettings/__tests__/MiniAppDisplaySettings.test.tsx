// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppDisplaySettings from '../MiniAppDisplaySettings'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children }: React.PropsWithChildren) => <button type="button">{children}</button>,
  PageSidePanelItem: ({
    action,
    children,
    description,
    title
  }: React.PropsWithChildren<{ action?: React.ReactNode; description: React.ReactNode; title: React.ReactNode }>) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
      {children}
    </section>
  ),
  PageSidePanelSection: ({ children, title }: React.PropsWithChildren<{ title: React.ReactNode }>) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Slider: () => <input type="range" />,
  Switch: () => <input type="checkbox" />,
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/Selector', () => ({ default: () => <select aria-label="region" /> }))
vi.mock('@renderer/services/toast', () => ({ toast: { info: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MiniAppDisplaySettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(cleanup)

  it('does not offer a region selector in the CN edition', () => {
    render(<MiniAppDisplaySettings appEdition="cn" />)

    expect(screen.queryByText('settings.miniApps.region.title')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'region' })).not.toBeInTheDocument()
    expect(screen.getByText('settings.miniApps.open_link_external.title')).toBeInTheDocument()
  })

  it('keeps the region selector available in the global edition', () => {
    render(<MiniAppDisplaySettings appEdition="global" />)

    expect(screen.getByText('settings.miniApps.region.title')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'region' })).toBeInTheDocument()
  })
})
