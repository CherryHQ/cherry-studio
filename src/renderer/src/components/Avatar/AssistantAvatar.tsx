import { Assistant } from '@renderer/types'
import { Avatar, AvatarProps } from 'antd'
import { first } from 'lodash'
import { FC } from 'react'

interface Props {
  assistant: Assistant
  size: number
  props?: AvatarProps
  className?: string
}

const AssistantAvatar: FC<Props> = ({ assistant, size, props, className }) => {
  return (
    <Avatar
      icon={<span>{assistant.emoji}</span>}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent'
      }}
      {...props}
      className={className}>
      {first(assistant.name)}
    </Avatar>
  )
}

export default AssistantAvatar
