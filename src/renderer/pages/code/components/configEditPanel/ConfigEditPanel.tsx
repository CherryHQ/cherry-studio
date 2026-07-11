import type { FC } from 'react'

import { ConfigEditDialogBody } from './ConfigEditDialogBody'
import type { ConfigEditPanelProps } from './types'
import { useConfigEditPanelBodyProps } from './useConfigEditPanelBodyProps'

export type { ConfigEditPanelProps } from './types'

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const bodyProps = useConfigEditPanelBodyProps(props)
  return <ConfigEditDialogBody {...bodyProps} />
}
