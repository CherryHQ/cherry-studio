import { AppWindow } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { getComputerUseApp } from '@shared/ai/tools/computerUse'

export function ComputerUseAppIcon({ output }: { output: unknown }) {
  const app = getComputerUseApp(output)
  if (!app) return null

  return (
    <Avatar className="size-4 rounded-none" title={app.name}>
      {app.icon && <AvatarImage src={`data:image/png;base64,${app.icon.data}`} alt={app.name} />}
      <AvatarFallback className="rounded-none" role="img" aria-label={app.name}>
        <AppWindow size={14} aria-hidden="true" />
      </AvatarFallback>
    </Avatar>
  )
}
