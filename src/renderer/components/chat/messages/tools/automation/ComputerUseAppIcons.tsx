import { AppWindow } from 'lucide-react'
import useSWRImmutable from 'swr/immutable'

import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { ComputerUseApp } from '@shared/ipc/schemas/computerUse'

function AppIcon({ app }: { app: ComputerUseApp }) {
  const { data } = useSWRImmutable(
    app.identity ? ['computer-use-app-icon', app.identity] : null,
    ([, identity]) => ipcApi.request('computer_use.get_app_icon', { identity }),
    { shouldRetryOnError: false }
  )
  return (
    <Avatar className="size-4 shrink-0 rounded-none" title={app.name}>
      {data?.status === 'available' && (
        <AvatarImage src={`data:image/png;base64,${data.icon.dataBase64}`} alt={app.name} />
      )}
      <AvatarFallback className="rounded-none" role="img" aria-label={app.name}>
        <AppWindow size={14} aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  )
}

export function ComputerUseAppIcons({ cell }: { cell?: string }) {
  const { data: apps } = useSWRImmutable(
    cell ? ['computer-use-call-apps', cell] : null,
    ([, cell]) => ipcApi.request('computer_use.get_call_apps', { cell }),
    { shouldRetryOnError: false }
  )
  return apps?.map((app) => <AppIcon key={app.id} app={app} />)
}
