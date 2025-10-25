import { Button, ButtonProps, cn } from '@heroui/react'
import { PlusIcon } from 'lucide-react'

const AddButton = ({ children, className, ...props }: ButtonProps) => {
  return (
    <Button
      className={cn(
        'h-9 w-[calc(var(--assistants-width)-20px)] justify-start rounded-lg bg-transparent px-3 text-[13px] text-[var(--color-text-2)] hover:bg-[var(--color-list-item)]',
        className
      )}
      startContent={<PlusIcon size={16} className="shrink-0" />}
      {...props}>
      {children}
    </Button>
  )
}

export default AddButton
