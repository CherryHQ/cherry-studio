import type { ButtonApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import type { FC } from 'react'

import { resolvedText } from '../lib/resolved'
import type { BuildChild, UarComponentProps } from '../react/types'
import { Button as UiButton } from './ui/button'

type ButtonProps = UarComponentProps<typeof ButtonApi>

const VARIANT_MAP = {
  default: 'outline',
  primary: 'default',
  borderless: 'ghost'
} as const

/**
 * `Button` — dispatches its bound `action` on click. `checks` (validation
 * rules) resolve into `isValid`/`validationErrors` on the props object
 * itself (per `GenericBinder`'s `CHECKABLE` handling); we surface that via
 * `aria-invalid` rather than blocking the click, since the protocol treats
 * validity as advisory UI state, not a hard client-side gate — the agent
 * (server side) remains the source of truth for whether an action is
 * accepted.
 */
export const UarButton: FC<{ props: ButtonProps; buildChild: BuildChild }> = ({ props, buildChild }) => {
  const variant = VARIANT_MAP[props.variant ?? 'default']
  return (
    <UiButton
      data-a2ui-component="Button"
      variant={variant}
      aria-invalid={props.isValid === false || undefined}
      aria-label={resolvedText(props.accessibility?.label)}
      title={resolvedText(props.accessibility?.description)}
      onClick={props.action}
      style={props.weight ? { flexGrow: props.weight } : undefined}>
      {buildChild(props.child)}
    </UiButton>
  )
}
