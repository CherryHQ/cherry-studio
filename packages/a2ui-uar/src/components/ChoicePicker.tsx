import type { ChoicePickerApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import { useId, type FC } from 'react'
import { ListBox, ListBoxItem, type Selection } from 'react-aria-components'

import { useUarI18n } from '../i18n'
import { cn } from '../lib/cn'
import { resolvedText } from '../lib/resolved'
import type { UarComponentProps } from '../react/types'

type ChoicePickerProps = UarComponentProps<typeof ChoicePickerApi>

/**
 * `ChoicePicker` — single/multi-select from a fixed option list.
 *
 * Uses `react-aria-components`' `ListBox` (rather than shadcn's Radix/Base
 * UI `Select`, which is single-value only) because `variant:
 * multipleSelection` requires real multi-select listbox semantics
 * (`aria-multiselectable`, roving tabindex, type-ahead) — this is exactly
 * the accessibility-primitive gap `react-aria-components` is meant to fill
 * alongside the shadcn/ui visual baseline.
 */
export const UarChoicePicker: FC<{ props: ChoicePickerProps }> = ({ props }) => {
  const id = useId()
  const errorId = `${id}-error`
  const { t } = useUarI18n()
  const selectionMode = props.variant === 'multipleSelection' ? 'multiple' : 'single'
  const selectedKeys = new Set(props.value ?? [])

  const handleSelectionChange = (keys: Selection) => {
    if (keys === 'all') return
    props.setValue(Array.from(keys, String))
  }

  return (
    <div data-a2ui-component="ChoicePicker" className="flex flex-col gap-1.5">
      {props.label ? <span className="text-sm font-medium">{props.label}</span> : null}
      <ListBox
        aria-label={props.label ?? resolvedText(props.accessibility?.label) ?? t('choices')}
        aria-invalid={props.isValid === false || undefined}
        aria-describedby={props.validationErrors?.length ? errorId : undefined}
        selectionMode={selectionMode}
        selectedKeys={selectedKeys}
        onSelectionChange={handleSelectionChange}
        className="flex flex-col gap-1 rounded-md bg-surface p-1">
        {props.options.map((option) => (
          <ListBoxItem
            key={option.value}
            id={option.value}
            textValue={resolvedText(option.label)}
            className={({ isSelected, isFocused }: { isSelected: boolean; isFocused: boolean }) =>
              cn(
                'flex min-h-11 cursor-pointer items-center rounded-sm px-2 py-2 text-sm outline-none',
                isFocused && 'bg-muted',
                isSelected && "bg-primary font-semibold text-primary-foreground before:me-2 before:content-['✓']"
              )
            }>
            {resolvedText(option.label)}
          </ListBoxItem>
        ))}
      </ListBox>
      {props.validationErrors?.length ? (
        <span id={errorId} role="alert" className="text-xs text-destructive">
          {props.validationErrors.join(' ')}
        </span>
      ) : null}
    </div>
  )
}
