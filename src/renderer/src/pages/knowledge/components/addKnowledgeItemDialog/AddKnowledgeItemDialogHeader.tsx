import { DialogClose, DialogTitle } from '@cherrystudio/ui'
import { X } from 'lucide-react'

interface AddKnowledgeItemDialogHeaderProps {
  closeLabel: string
  title: string
}

const AddKnowledgeItemDialogHeader = ({ closeLabel, title }: AddKnowledgeItemDialogHeaderProps) => {
  return (
    <div className="flex shrink-0 items-start justify-between px-4 pt-3 pb-2">
      <DialogTitle className="pt-0.5 leading-4">{title}</DialogTitle>
      <DialogClose asChild>
        <button
          type="button"
          aria-label={closeLabel}
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </DialogClose>
    </div>
  )
}

export default AddKnowledgeItemDialogHeader
