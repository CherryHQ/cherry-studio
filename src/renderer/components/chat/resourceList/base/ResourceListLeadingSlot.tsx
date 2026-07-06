import { cn } from '@renderer/utils/style'
import type { ComponentProps, Ref } from 'react'

import {
  RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS,
  RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS,
  RESOURCE_LIST_LEADING_SLOT_BASE_CLASS
} from './resourceListLayout'

type ResourceListLeadingSlotVariant = 'groupHeader' | 'item' | 'loading'

const RESOURCE_LIST_LEADING_SLOT_CLASS_BY_VARIANT: Record<ResourceListLeadingSlotVariant, string | undefined> = {
  groupHeader: RESOURCE_LIST_GROUP_HEADER_LEADING_SLOT_CLASS,
  item: RESOURCE_LIST_ITEM_LEADING_SLOT_CLASS,
  loading: undefined
}

export type ResourceListLeadingSlotProps = ComponentProps<'span'> & {
  ref?: Ref<HTMLSpanElement>
  variant?: ResourceListLeadingSlotVariant
}

export function ResourceListLeadingSlot({
  className,
  ref,
  variant = 'item',
  children,
  'aria-hidden': ariaHidden,
  ...props
}: ResourceListLeadingSlotProps) {
  return (
    <span
      ref={ref}
      aria-hidden={ariaHidden ?? (children == null ? true : undefined)}
      data-resource-list-leading-slot="true"
      className={cn(
        RESOURCE_LIST_LEADING_SLOT_BASE_CLASS,
        RESOURCE_LIST_LEADING_SLOT_CLASS_BY_VARIANT[variant],
        className
      )}
      {...props}>
      {children}
    </span>
  )
}
