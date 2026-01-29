import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { PlusIcon } from 'lucide-react'

const AddButton = ({ children, className, ...props }) => {
  return (
    <Button
      {...props}
      onClick={props.onClick}
      className={cn(
        'h-9 w-[calc(var(--assistants-width)-20px)] justify-start rounded-lg bg-transparent px-3 text-(--color-text-2) text-[13px] hover:bg-(--color-list-item)',
        className
      )}>
      <PlusIcon size={16} className="shrink-0" />
      {children}
    </Button>
  )
}

export default AddButton
