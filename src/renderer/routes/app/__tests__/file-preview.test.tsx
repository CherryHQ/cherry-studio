import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/pages/FilePreviewPage', () => ({
  FilePreviewPage: ({ filePath }: { filePath?: FilePath }) => (
    <div data-testid="file-preview-route">{filePath ?? 'invalid'}</div>
  )
}))

import { Route as FilePreviewRoute } from '../file-preview'

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderRoute(entry: string) {
  const rootRoute = createRootRoute({ component: Outlet })
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: 'app',
    component: Outlet
  })
  const filePreviewRoute = FilePreviewRoute.update({
    path: '/file-preview',
    getParentRoute: () => appRoute
  } as any)
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([filePreviewRoute])]),
    history: createMemoryHistory({ initialEntries: [entry] })
  })

  render(<RouterProvider router={router} />)
}

describe('/app/file-preview route', () => {
  it('canonicalizes a valid search path before rendering the preview page', async () => {
    renderRoute('/app/file-preview?path=%2Ftmp%2Fnotes%2F..%2Freport.md')

    expect(await screen.findByTestId('file-preview-route')).toHaveTextContent('/tmp/report.md')
  })

  it.each(['/app/file-preview', '/app/file-preview?path=relative%2Freport.md'])(
    'contains missing or invalid search input for %s',
    async (entry) => {
      renderRoute(entry)

      expect(await screen.findByTestId('file-preview-route')).toHaveTextContent('invalid')
    }
  )
})
