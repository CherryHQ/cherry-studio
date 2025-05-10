import { getFlowEngineProviderLogo } from '@renderer/config/workflowProviders'
import { Chatflow } from '@renderer/types'
import { Avatar, AvatarProps } from 'antd'
import { first } from 'lodash'
import { FC } from 'react'

interface Props {
  chatflow: Chatflow
  size: number
  props?: AvatarProps
  className?: string
}

const ChatflowAvatar: FC<Props> = ({ chatflow, size, props, className }) => {
  return (
    <Avatar
      src={getFlowEngineProviderLogo(chatflow?.providerId || '')}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      {...props}
      className={className}>
      {first(chatflow?.name)}
    </Avatar>
  )
}

export default ChatflowAvatar
