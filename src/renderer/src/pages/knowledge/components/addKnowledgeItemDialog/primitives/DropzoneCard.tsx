import { Dropzone, DropzoneEmptyState } from '@cherrystudio/ui'
import type { LucideIcon } from 'lucide-react'

import type { DropzoneOnDrop } from '../types'

interface DropzoneCardProps {
  description: string
  icon: LucideIcon
  onDrop: DropzoneOnDrop
  title: string
}

const DropzoneCard = ({ description, icon: Icon, onDrop, title }: DropzoneCardProps) => {
  return (
    <Dropzone
      multiple
      maxFiles={0}
      onDrop={onDrop}
      className="min-h-29.5 shrink-0 rounded-lg border-2 border-border/30 border-dashed bg-muted/[0.06] p-5 text-center text-foreground shadow-none hover:border-border/30 hover:bg-muted/[0.06] hover:text-foreground">
      <DropzoneEmptyState className="gap-2">
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/55">
            <Icon className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm leading-4">{title}</p>
            <p className="text-muted-foreground/60 text-xs leading-4">{description}</p>
          </div>
        </div>
      </DropzoneEmptyState>
    </Dropzone>
  )
}

export default DropzoneCard
