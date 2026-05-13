import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'

export interface ToolDisclosureItem {
  key: string
  label: ReactNode
  children?: ReactNode
  className?: string
  classNames?: {
    item?: string
    header?: string
    body?: string
  }
}

interface ToolDisclosureProps {
  items: ToolDisclosureItem[]
  activeKey?: string[]
  defaultActiveKey?: string[]
  onActiveKeyChange?: (keys: string[]) => void
  className?: string
  itemClassName?: string
  triggerClassName?: string
  bodyClassName?: string
  variant?: 'default' | 'light'
}

export function ToolDisclosure({
  items,
  activeKey,
  defaultActiveKey,
  onActiveKeyChange,
  className,
  itemClassName,
  triggerClassName,
  bodyClassName,
  variant = 'default'
}: ToolDisclosureProps) {
  const isLight = variant === 'light'

  return (
    <Accordion
      type="multiple"
      value={activeKey}
      defaultValue={defaultActiveKey}
      onValueChange={onActiveKeyChange}
      className={cn(
        isLight
          ? 'w-full overflow-hidden bg-transparent'
          : 'w-full overflow-hidden rounded-[7px] border border-border bg-background',
        className
      )}>
      {items.map((item) => (
        <AccordionItem
          key={item.key}
          value={item.key}
          className={cn('border-none', itemClassName, item.classNames?.item, item.className)}>
          <AccordionTrigger
            className={cn(
              isLight
                ? 'w-full justify-start gap-2 py-0.5 hover:no-underline [&>svg]:order-last [&>svg]:ml-auto [&>svg]:text-foreground-muted [&>svg]:opacity-0 [&>svg]:transition-opacity [&>svg]:duration-150 group-hover/tool:[&>svg]:opacity-100'
                : 'items-center px-2.5 py-2 hover:no-underline [&>svg]:text-foreground-muted',
              triggerClassName,
              item.classNames?.header
            )}>
            {item.label}
          </AccordionTrigger>
          <AccordionContent
            data-testid={`collapse-content-${item.key}`}
            className={cn(
              isLight ? 'ml-[8px] border-border border-l pt-1 pr-0 pb-2 pl-[26px]' : 'p-2.5',
              bodyClassName,
              item.classNames?.body
            )}>
            {item.children}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
