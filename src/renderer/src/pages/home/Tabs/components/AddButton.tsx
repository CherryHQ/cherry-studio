import { Button, cn } from '@cherrystudio/ui'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'

interface Props extends React.ComponentProps<typeof Button> {
  children: React.ReactNode
}

const AddButton: FC<Props> = ({ children, className, ...props }) => {
  return (
    <Button
      {...props}
      variant="ghost"
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
