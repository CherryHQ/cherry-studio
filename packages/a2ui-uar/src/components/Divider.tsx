import type { DividerApi } from '@prometheus-ags/a2ui-core/v0_9/basic_catalog'
import type { FC } from 'react'

import type { UarComponentProps } from '../react/types'
import { Separator } from './ui/separator'

type DividerProps = UarComponentProps<typeof DividerApi>

/** `Divider` — a horizontal or vertical rule. */
export const UarDivider: FC<{ props: DividerProps }> = ({ props }) => (
  <Separator data-a2ui-component="Divider" orientation={props.axis ?? 'horizontal'} />
)
