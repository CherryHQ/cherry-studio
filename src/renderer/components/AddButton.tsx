import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { PlusIcon } from 'lucide-react'

const AddButton = ({
  children,
  className,
  ...props
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}) => {
  return (
    <Button
      {...props}
      variant="ghost"
      className={cn(
        'h-9 w-[calc(var(--assistants-width)-20px)] justify-start rounded-lg bg-transparent px-3 text-[13px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground',
        className
      )}>
      <PlusIcon size={16} className="shrink-0" />
      {children}
    </Button>
  )
}

export default AddButton
