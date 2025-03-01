import { getModelLogo } from '@renderer/config/models'
import { Model } from '@renderer/types'
import { Avatar, AvatarProps } from 'antd'
import { first } from 'lodash'
import { FC } from 'react'

interface Props {
  model: Model
  size: number
  props?: AvatarProps
}

const ModelAvatar: FC<Props> = ({ model, size, props }) => {
  return (
    <Avatar
      src={getModelLogo(model?.id || '')}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      {...props}>
      {first(model?.name)}
    </Avatar>
  )
}

export default ModelAvatar
