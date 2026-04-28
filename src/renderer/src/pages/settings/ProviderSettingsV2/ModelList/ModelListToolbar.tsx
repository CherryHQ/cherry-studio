import type React from 'react'

import ModelListHeader, { type ModelListHeaderProps } from './ModelListHeader'

export type ModelListToolbarProps = ModelListHeaderProps

const ModelListToolbar: React.FC<ModelListToolbarProps> = (props) => {
  return <ModelListHeader {...props} />
}

export default ModelListToolbar
