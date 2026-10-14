import { Terminal } from 'lucide-react'

import { Avatar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

export function CliModelAvatar({ className }: { className?: string }) {
  return (
    <Avatar
      className={cn('size-5 items-center justify-center bg-muted text-muted-foreground', className)}
      aria-hidden="true">
      <Terminal className="size-3" />
    </Avatar>
  )
}
