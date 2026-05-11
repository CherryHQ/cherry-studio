import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export interface DisclosureProps extends Omit<ComponentProps<'div'>, 'children' | 'title' | 'onToggle'> {
  children: ReactNode
  contentClassName?: string
  defaultOpen?: boolean
  description?: ReactNode
  itemValue?: string
  onOpenChange?: (open: boolean) => void
  open?: boolean
  title: ReactNode
  triggerClassName?: string
}

export function Disclosure({
  children,
  className,
  contentClassName,
  defaultOpen,
  description,
  itemValue = 'content',
  onOpenChange,
  open,
  title,
  triggerClassName,
  ...props
}: DisclosureProps) {
  const controlledProps =
    open === undefined ? { defaultValue: defaultOpen ? itemValue : undefined } : { value: open ? itemValue : '' }

  return (
    <div data-slot="chat-disclosure" className={className} {...props}>
      <Accordion
        type="single"
        collapsible
        onValueChange={(value) => onOpenChange?.(value === itemValue)}
        {...controlledProps}>
        <AccordionItem value={itemValue} className="border-border/60">
          <AccordionTrigger className={cn('px-3 py-2 text-sm', triggerClassName)}>
            <span className="min-w-0 text-left">
              <span className="block truncate">{title}</span>
              {description && (
                <span className="mt-0.5 block text-muted-foreground text-xs leading-5">{description}</span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className={cn('px-3 pb-3', contentClassName)}>{children}</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
