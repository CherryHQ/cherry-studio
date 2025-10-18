import { Avatar, cn } from '@heroui/react'
import { getModelLogo } from '@renderer/config/models'
import type { ApiModel } from '@renderer/types'
import React from 'react'

import Ellipsis from './Ellipsis'

export interface ModelLabelProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
  model?: ApiModel
  classNames?: {
    container?: string
    avatar?: string
    modelName?: string
    divider?: string
    providerName?: string
  }
}

export const ApiModelLabel: React.FC<ModelLabelProps> = ({ model, className, classNames, ...props }) => {
  return (
    <div className={cn('flex items-center gap-1', className, classNames?.container)} {...props}>
      <Avatar src={model ? getModelLogo(model.id) : undefined} className={cn('h-4 w-4', classNames?.avatar)} />
      <Ellipsis className={classNames?.modelName}>{model?.name}</Ellipsis>
      <span className={classNames?.divider}> | </span>
      <Ellipsis className={classNames?.providerName}>{model?.provider_name}</Ellipsis>
    </div>
  )
}
