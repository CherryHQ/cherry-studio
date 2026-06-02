import { Checkbox } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps } from 'react'

const neutralCheckboxClassName =
  'border-input hover:bg-accent data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background [&_[data-slot=checkbox-indicator]>svg]:stroke-background [&_[data-slot=checkbox-indicator]>svg]:text-background'

function NeutralCheckbox({ className, ...props }: ComponentProps<typeof Checkbox>) {
  return <Checkbox className={cn(neutralCheckboxClassName, className)} {...props} />
}

export { NeutralCheckbox }
