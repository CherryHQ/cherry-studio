import { Button, cn } from '@cherrystudio/ui'
import { PlusIcon } from 'lucide-react'

const AddButton = ({ children, className, ...props }) => {
  return (
    <Button
      {...props}
      onClick={props.onClick}
      className={cn(
        'h-9 w-[calc(var(--assistants-width)-20px)] justify-start rounded-lg bg-transparent px-3 text-[13px] text-[var(--color-text-2)] hover:bg-[var(--color-list-item)]',
        className
      )}>
      <PlusIcon size={16} className="shrink-0" />
      {children}
    </Button>
  )
}

export default AddButton
