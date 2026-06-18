// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MiniAppListColumn from '../MiniAppListColumn'

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children }: React.PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  Sortable: ({
    items,
    renderItem
  }: {
    items: MiniApp[]
    renderItem: (app: MiniApp, index: number) => React.ReactNode
  }) => (
    <>
      {items.map((item, index) => (
        <div key={item.appId}>{renderItem(item, index)}</div>
      ))}
    </>
  ),
  Tooltip: ({ children }: React.PropsWithChildren<{ content: React.ReactNode }>) => <>{children}</>
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: ({ logo }: { logo: string }) => <span data-testid={`logo-${logo}`} />
}))

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key} ${options.name}` : key)
  })
}))

const miniApp = (appId: string, name: string): MiniApp => ({
  appId,
  presetMiniAppId: appId,
  name,
  url: `https://${appId}.example.com`,
  logo: appId,
  status: 'enabled',
  orderKey: appId
})

afterEach(() => {
  cleanup()
})

describe('MiniAppListColumn', () => {
  it('includes each app name in hide row accessible names', () => {
    render(
      <MiniAppListColumn
        title="Visible Mini Apps"
        count={2}
        apps={[miniApp('chatgpt', 'ChatGPT'), miniApp('gemini', 'Gemini')]}
        onToggle={vi.fn()}
        onReorder={vi.fn()}
        toggleAction="hide"
      />
    )

    expect(screen.getByRole('button', { name: 'settings.miniApps.hide_app ChatGPT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.miniApps.hide_app Gemini' })).toBeInTheDocument()
  })

  it('includes each app name in show row accessible names', () => {
    render(
      <MiniAppListColumn
        title="Hidden Mini Apps"
        count={2}
        apps={[miniApp('chatgpt', 'ChatGPT'), miniApp('gemini', 'Gemini')]}
        onToggle={vi.fn()}
        onReorder={vi.fn()}
        toggleAction="show"
      />
    )

    expect(screen.getByRole('button', { name: 'settings.miniApps.show_app ChatGPT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.miniApps.show_app Gemini' })).toBeInTheDocument()
  })
})
