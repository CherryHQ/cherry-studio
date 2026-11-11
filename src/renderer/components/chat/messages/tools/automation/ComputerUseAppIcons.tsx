import useSWRImmutable from 'swr/immutable'

import { ComputerUseAppIcon } from '@renderer/components/ComputerUseAppIcon'
import { ipcApi } from '@renderer/ipc'

export function ComputerUseAppIcons({ cell }: { cell?: string }) {
  const { data: apps } = useSWRImmutable(
    cell ? ['computer-use-call-apps', cell] : null,
    ([, cell]) => ipcApi.request('computer_use.get_call_apps', { cell }),
    { shouldRetryOnError: false }
  )
  return apps?.map((app) => <ComputerUseAppIcon key={app.id} app={app} />)
}
