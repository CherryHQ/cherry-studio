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
}

export function ToolDisclosure({
  items,
  activeKey,
  defaultActiveKey,
  onActiveKeyChange,
  className,
  itemClassName,
  triggerClassName,
  bodyClassName
}: ToolDisclosureProps) {
  return (
    <Accordion
      type="multiple"
      value={activeKey}
      defaultValue={defaultActiveKey}
      onValueChange={onActiveKeyChange}
      className={cn(
        'w-full overflow-hidden rounded-[7px] border border-(--color-border) bg-(--color-background)',
        className
      )}>
      {items.map((item) => (
        <AccordionItem
          key={item.key}
          value={item.key}
          className={cn('border-none', itemClassName, item.classNames?.item, item.className)}>
          <AccordionTrigger
            className={cn(
              'items-center px-2.5 py-2 hover:no-underline [&>svg]:text-(--color-text-3)',
              triggerClassName,
              item.classNames?.header
            )}>
            {item.label}
          </AccordionTrigger>
          <AccordionContent
            data-testid={`collapse-content-${item.key}`}
            className={cn('p-2.5', bodyClassName, item.classNames?.body)}>
            {item.children}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
