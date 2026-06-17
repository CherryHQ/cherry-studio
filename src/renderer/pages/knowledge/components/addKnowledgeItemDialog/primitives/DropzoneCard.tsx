import { Dropzone, DropzoneEmptyState } from '@cherrystudio/ui'

import type { DropzoneOnDrop } from '../types'

interface DropzoneCardProps {
  description: string
  onDrop: DropzoneOnDrop
  title: string
}

const DropzoneCard = ({ description, onDrop, title }: DropzoneCardProps) => {
  return (
    <Dropzone
      multiple
      maxFiles={0}
      onDrop={onDrop}
      className="min-h-24 shrink-0 whitespace-normal rounded-md border border-border-muted border-dashed px-4 py-4 text-center text-foreground-muted shadow-none transition-colors hover:border-border-hover hover:bg-muted/30 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      <DropzoneEmptyState>
        <div className="flex flex-col items-center justify-center gap-2.5">
          <p className="text-sm leading-5">{title}</p>
          <p className="text-xs leading-5">{description}</p>
        </div>
      </DropzoneEmptyState>
    </Dropzone>
  )
}

export default DropzoneCard
