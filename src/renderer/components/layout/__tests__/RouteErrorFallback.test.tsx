import i18n from '@renderer/i18n/resolver'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RouteErrorFallback } from '../RouteErrorFallback'

// Exercises the REAL @tanstack/react-router error path with a tiny hand-built route
// tree — TabRouter.test.tsx mocks the whole library, so it cannot cover this.
const buildRouter = (routeComponent: () => React.ReactElement) => {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: routeComponent
  })
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: RouteErrorFallback
  })
}

describe('RouteErrorFallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('contains a route render error inside the router instead of bubbling it up', async () => {
    const router = buildRouter(() => {
      throw new Error('route exploded')
    })

    render(<RouterProvider router={router} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('error.boundary.default.message'))
    expect(alert).toHaveTextContent('route exploded')
  })

  it('re-renders the route when retry is clicked after the cause clears', async () => {
    let shouldThrow = true
    const router = buildRouter(() => {
      if (shouldThrow) throw new Error('route exploded')
      return <div>route recovered</div>
    })
    const user = userEvent.setup()

    render(<RouterProvider router={router} />)
    await screen.findByRole('alert')

    shouldThrow = false
    await user.click(screen.getByRole('button', { name: i18n.t('common.retry') }))

    expect(await screen.findByText('route recovered')).toBeInTheDocument()
  })

  // B6: wired as defaultErrorComponent for every tab router, so it must not
  // statically reach the heavy error bucket.
  it('does not statically reach zod/ai/axios through its import graph', async () => {
    vi.resetModules()
    const loaded = vi.fn()
    const heavyDeps = ['zod', 'ai', 'axios']
    for (const dep of heavyDeps) {
      vi.doMock(dep, async (importOriginal) => {
        loaded(dep)
        return await importOriginal()
      })
    }

    try {
      await import('../RouteErrorFallback')
      expect(loaded).not.toHaveBeenCalled()
    } finally {
      for (const dep of heavyDeps) {
        vi.doUnmock(dep)
      }
      vi.resetModules()
    }
  })
})
