import { describe, expect, it } from 'vitest'

import { Route as detailRoute } from '../scheduled-tasks.$taskId'
import { Route as indexRoute } from '../scheduled-tasks.index'

describe('legacy scheduled task links', () => {
  it.each([
    { route: indexRoute, search: {} },
    { route: detailRoute, search: { taskId: 'task-1' } }
  ])('redirects to the task page while preserving the selected task', ({ route, search }) => {
    const beforeLoad = route.options.beforeLoad as (context: { params: { taskId: string } }) => never
    let redirect: unknown
    try {
      beforeLoad({ params: { taskId: 'task-1' } })
    } catch (error) {
      redirect = error
    }
    expect(redirect).toMatchObject({
      options: { to: '/app/scheduled-tasks', search, replace: true }
    })
  })
})
