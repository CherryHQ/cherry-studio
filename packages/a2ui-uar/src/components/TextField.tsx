import type { TextFieldApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import { useId, type ChangeEvent, type FC } from 'react'

import { resolvedText } from '../lib/resolved'
import type { UarComponentProps } from '../react/types'
import { Input } from './ui/input'
import { Label } from './ui/label'

type TextFieldProps = UarComponentProps<typeof TextFieldApi>

const HTML_TYPE: Record<string, string> = {
  longText: 'text',
  number: 'number',
  shortText: 'text',
  obscured: 'password'
}

/**
 * `TextField` — two-way bound text input. `GenericBinder` generates
 * `setValue` for the `value: DynamicString` field, so committing a value
 * back to the data model is just calling `props.setValue`.
 */
export const UarTextField: FC<{ props: TextFieldProps }> = ({ props }) => {
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy =
    [props.accessibility?.description ? descriptionId : null, props.validationErrors?.length ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined
  const isLongText = props.variant === 'longText'
  const sharedProps = {
    id,
    value: props.value ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.setValue(e.target.value),
    'aria-invalid': props.isValid === false || undefined,
    'aria-describedby': describedBy,
    pattern: props.validationRegexp
  }

  return (
    <div data-a2ui-component="TextField" className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      {isLongText ? (
        <textarea
          {...sharedProps}
          className="min-h-24 w-full rounded-md bg-surface px-2.5 py-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      ) : (
        <Input type={HTML_TYPE[props.variant ?? 'shortText']} {...sharedProps} />
      )}
      {props.accessibility?.description ? (
        <span id={descriptionId} className="text-xs text-muted-foreground">
          {resolvedText(props.accessibility.description)}
        </span>
      ) : null}
      {props.validationErrors?.length ? (
        <span id={errorId} role="alert" className="text-xs text-destructive">
          {props.validationErrors.join(' ')}
        </span>
      ) : null}
    </div>
  )
}
