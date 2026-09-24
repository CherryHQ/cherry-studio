import type { CardApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import type { FC } from 'react'

import type { BuildChild, UarComponentProps } from '../react/types'
import { Card as UiCard, CardContent } from './ui/card'

type CardProps = UarComponentProps<typeof CardApi>

/** `Card` — a container with a single required `child` (per the protocol: multiple elements must be wrapped in a Row/Column first). */
export const UarCard: FC<{ props: CardProps; buildChild: BuildChild }> = ({ props, buildChild }) => {
  return (
    <UiCard data-a2ui-component="Card">
      <CardContent>{buildChild(props.child)}</CardContent>
    </UiCard>
  )
}
