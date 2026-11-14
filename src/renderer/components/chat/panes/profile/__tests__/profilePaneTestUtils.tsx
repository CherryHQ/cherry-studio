import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'

import { RightPanelProvider } from '../../Shell'

type QueryOptions = { params?: Record<string, string>; query?: Record<string, unknown>; enabled?: boolean }

/** Serves `useQuery` per route from the unified DataApi mock; unknown routes stay empty. */
export function serveQueries(routes: Record<string, (options: QueryOptions) => unknown>) {
  mockUseQuery.mockImplementation((path: string, options?: QueryOptions) => {
    const data = options?.enabled === false ? undefined : routes[path]?.(options ?? {})
    return {
      data,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(data)
    }
  })
}

/** Records every edit dialog request made through `openResourceEditDialog`. */
export function recordEditDialogRequests() {
  const requests: ResourceEditDialogTarget[] = []
  const stop = EventEmitter.on(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, (target) => {
    requests.push(target as ResourceEditDialogTarget)
  })
  return { requests, stop }
}

const NO_CAPABILITIES = [] as const
const NO_SCOPE = {}

/** Renders a pane body inside the right-pane controller it always lives in. */
export function renderInRightPane(ui: ReactElement) {
  return render(
    <RightPanelProvider capabilities={NO_CAPABILITIES} scope={NO_SCOPE}>
      {ui}
    </RightPanelProvider>
  )
}
