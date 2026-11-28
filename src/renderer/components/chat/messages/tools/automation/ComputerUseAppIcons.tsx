import type { ReactNode } from 'react'
import useSWRImmutable from 'swr/immutable'

import { ComputerUseAppIcon } from '@renderer/components/ComputerUseAppIcon'
import { ipcApi } from '@renderer/ipc'

export function ComputerUseAppIcons({ cell, fallback }: { cell?: string; fallback?: ReactNode }) {
  const { data: apps } = useSWRImmutable(
    cell ? ['computer-use-call-apps', cell] : null,
    ([, cell]) => ipcApi.request('computer_use.get_call_apps', { cell }),
    { shouldRetryOnError: false }
  )
  return apps?.length ? apps.map((app) => <ComputerUseAppIcon key={app.id} app={app} />) : fallback
}
