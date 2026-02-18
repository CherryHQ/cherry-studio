import type { CompoundIcon } from '../../types'
import { DatabricksAvatar } from './avatar'
import { Databricks } from './color'
import { DatabricksMono } from './mono'

export const DatabricksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Databricks, {
  Color: Databricks,
  Mono: DatabricksMono,
  Avatar: DatabricksAvatar,
  colorPrimary: '#FF3621'
})
export default DatabricksIcon
