import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { Route as detailRoute } from '../scheduled-tasks.$taskId'
import { Route as indexRoute } from '../scheduled-tasks.index'

describe('legacy scheduled task links', () => {
  it.each([
    { path: '/settings/scheduled-tasks', search: {} },
    { path: '/settings/scheduled-tasks/task-1', search: { taskId: 'task-1' } },
    {
      path: '/settings/scheduled-tasks/task-1?notificationId=notice',
      search: { taskId: 'task-1', notificationId: 'notice' }
    }
  ])('opens the dedicated task page from $path', async ({ path, search }) => {
    const root = createRootRoute()
    const index = createRoute({
      getParentRoute: () => root,
      path: '/settings/scheduled-tasks',
      beforeLoad: indexRoute.options.beforeLoad
    })
    const detail = createRoute({
      getParentRoute: () => root,
      path: '/settings/scheduled-tasks/$taskId',
      validateSearch: detailRoute.options.validateSearch,
      beforeLoad: detailRoute.options.beforeLoad
    })
    const destination = createRoute({ getParentRoute: () => root, path: '/app/scheduled-tasks' })
    const history = createMemoryHistory({ initialEntries: ['/app/chat', path], initialIndex: 1 })
    const router = createRouter({ routeTree: root.addChildren([index, detail, destination]), history })
    await router.load()
    expect(router.state.location.pathname).toBe('/app/scheduled-tasks')
    expect(router.state.location.search).toEqual(search)
    expect(history.length).toBe(2)
    history.back()
    expect(history.location.pathname).toBe('/app/chat')
  })
})
