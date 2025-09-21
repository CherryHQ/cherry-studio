import { Avatar, AvatarProps, cn } from '@heroui/react'
import { getAgentAvatar } from '@renderer/config/agent'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import { AgentType } from '@renderer/types'
import React from 'react'

export const SettingsTitle: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <div className="mb-1 flex items-center gap-2 font-bold">{children}</div>
}

export const SettingsInline: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <div className="flex items-center justify-between gap-2">{children}</div>
}

export type AgentLabelProps = {
  type: AgentType
  name?: string
  classNames?: {
    container?: string
    avatar?: string
    name?: string
  }
  avatarProps?: AvatarProps
}

export const AgentLabel: React.FC<AgentLabelProps> = ({ type, name, classNames, avatarProps }) => {
  return (
    <div className={cn('flex items-center gap-2', classNames?.container)}>
      <Avatar src={getAgentAvatar(type)} title={type} {...avatarProps} className={cn('h-5 w-5', classNames?.avatar)} />
      <span className={classNames?.name}>{name ?? getAgentTypeLabel(type)}</span>
    </div>
  )
}
