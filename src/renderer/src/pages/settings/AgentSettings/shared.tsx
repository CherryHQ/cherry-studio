import { Avatar, AvatarProps, cn } from '@heroui/react'
import { getAgentAvatar } from '@renderer/config/agent'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import { AgentType } from '@renderer/types'
import React, { ReactNode } from 'react'

import { SettingDivider } from '..'

export interface SettingsTitleProps extends React.ComponentPropsWithRef<'div'> {
  actions?: ReactNode
}

export const SettingsTitle: React.FC<SettingsTitleProps> = ({ children, actions }) => {
  return (
    <div className={cn(actions ? 'justify-between' : undefined, 'mb-1 flex items-center gap-2')}>
      <span className="flex items-center gap-1 font-bold">{children}</span>
      {actions !== undefined && actions}
    </div>
  )
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

export interface SettingsItemProps extends React.ComponentPropsWithRef<'div'> {
  /** Add a divider beneath the item if true, defaults to true.  */
  divider?: boolean
  /** Apply row direction flex or not, defaults to false. */
  inline?: boolean
}

export const SettingsItem: React.FC<SettingsItemProps> = ({
  children,
  divider = true,
  inline = false,
  className,
  ...props
}) => {
  return (
    <>
      <div
        {...props}
        className={cn('flex flex-col', inline ? 'flex-row items-center justify-between gap-4' : undefined, className)}>
        {children}
      </div>
      {divider && <SettingDivider />}
    </>
  )
}

export const SettingsContainer: React.FC<React.ComponentPropsWithRef<'div'>> = ({ children, className, ...props }) => {
  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden', className)} {...props}>
      {children}
    </div>
  )
}
