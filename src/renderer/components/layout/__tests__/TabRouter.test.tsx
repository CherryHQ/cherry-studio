import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}))

vi.mock('@cherrystudio/ui', () => ({
  TooltipPortalContainerProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/routeTree.gen', () => ({
  routeTree: {}
}))

vi.mock('@tanstack/react-router', async () => {
  const { useSelectorPortalContainer } = await import(
    '@renderer/components/Selector/shell/SelectorPortalContainerContext'
  )

  return {
    createMemoryHistory: vi.fn(() => ({})),
    createRouter: vi.fn(() => ({
      navigate: routerMocks.navigate,
      subscribe: routerMocks.subscribe,
      state: {
        location: {
          href: '/app/translate'
        }
      }
    })),
    RouterProvider: () => {
      const container = useSelectorPortalContainer()

      return (
        <div
          data-testid="router-provider"
          data-has-selector-container={String(container instanceof HTMLElement)}
          data-selector-container-is-body={String(container === document.body)}
        />
      )
    }
  }
})

import { TabRouter } from '../TabRouter'

describe('TabRouter', () => {
  it('provides the tab root as the selector portal container', async () => {
    render(
      <TabRouter
        tab={{
          id: 'translate-tab',
          type: 'route',
          url: '/app/translate',
          title: 'Translate',
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-has-selector-container', 'true')
    )
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-selector-container-is-body', 'false')
  })
})
