// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@renderer/components/icons/LogoAvatar', () => ({
  default: ({ logo }: { logo: string }) => <span data-testid={`logo-${logo}`} />
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: () => undefined,
  useMiniAppLogo: () => undefined
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key} ${options.name}` : key)
  })
}))

const miniApp = (appId: string, name: string): MiniApp => ({
  kind: 'site',
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
  it.each([
    ['hide', 'Visible Mini Apps', 'settings.miniApps.hide_app'],
    ['show', 'Hidden Mini Apps', 'settings.miniApps.show_app']
  ] as const)('gives the %s rows app-specific names and keyboard actions', (toggleAction, title, labelKey) => {
    const chatgpt = miniApp('chatgpt', 'ChatGPT')
    const gemini = miniApp('gemini', 'Gemini')
    const onToggle = vi.fn()
    render(
      <MiniAppListColumn
        title={title}
        count={2}
        apps={[chatgpt, gemini]}
        onToggle={onToggle}
        onReorder={vi.fn()}
        toggleAction={toggleAction}
      />
    )

    expect(screen.getByRole('button', { name: `${labelKey} ChatGPT` })).toBeInTheDocument()
    const geminiRow = screen.getByRole('button', { name: `${labelKey} Gemini` })
    fireEvent.keyDown(geminiRow, { key: 'Enter' })

    expect(onToggle).toHaveBeenCalledWith(gemini)
  })
})
