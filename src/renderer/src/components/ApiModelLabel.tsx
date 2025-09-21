import { Avatar, cn } from '@heroui/react'
import { getModelLogo } from '@renderer/config/models'
import { ApiModel } from '@renderer/types'
import React from 'react'

export interface ModelLabelProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
  model?: ApiModel
}

export const ApiModelLabel: React.FC<ModelLabelProps> = ({ model, className, ...props }) => {
  return (
    <div className={cn('flex items-center gap-1', className)} {...props}>
      <Avatar src={model ? getModelLogo(model.id) : undefined} className="h-4 w-4" />
      <span>
        {model?.name} | {model?.provider_name}
      </span>
    </div>
  )
}
