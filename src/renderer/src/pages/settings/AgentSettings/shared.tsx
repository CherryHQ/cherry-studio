import { cn } from '@heroui/react'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import type { AgentEntity, AgentSessionEntity } from '@renderer/types'
import { Menu, Modal } from 'antd'
import type { ReactNode } from 'react'
import React from 'react'
import styled from 'styled-components'

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
  agent: AgentEntity | undefined | null
  classNames?: {
    container?: string
    avatar?: string
    name?: string
  }
}

export const AgentLabel: React.FC<AgentLabelProps> = ({ agent, classNames }) => {
  const emoji = agent?.configuration?.avatar

  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      <EmojiIcon emoji={emoji || '⭐️'} className={classNames?.avatar} />
      <span className={cn('truncate', 'text-[var(--color-text)]', classNames?.name)}>
        {agent?.name ?? (agent?.type ? getAgentTypeLabel(agent.type) : '')}
      </span>
    </div>
  )
}

export type SessionLabelProps = {
  session?: AgentSessionEntity
  className?: string
}

export const SessionLabel: React.FC<SessionLabelProps> = ({ session, className }) => {
  const displayName = session?.name ?? session?.id
  return (
    <>
      <span className={cn('truncate text-[var(--color-text)] text-sm', className)}>{displayName}</span>
    </>
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
    <div className={cn('flex flex-1 flex-col overflow-y-auto overflow-x-hidden pr-2', className)} {...props}>
      {children}
    </div>
  )
}

export const LeftMenu = styled.div`
  height: 100%;
  border-right: 0.5px solid var(--color-border);
`

export const Settings = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 16px 16px;
`

export const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
  .ant-menu-item {
    height: 36px;
    color: var(--color-text-2);
    display: flex;
    align-items: center;
    border: 0.5px solid transparent;
    border-radius: 6px;
    .ant-menu-title-content {
      line-height: 36px;
    }
  }
  .ant-menu-item-active {
    background-color: var(--color-background-soft) !important;
    transition: none;
  }
  .ant-menu-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .ant-menu-title-content {
      color: var(--color-text-1);
      font-weight: 500;
    }
  }
`

export const StyledMenu = styled(Menu)`
  width: 220px;
  padding: 5px;
  background: transparent;
  margin-top: 2px;
  .ant-menu-item {
    margin-bottom: 7px;
  }
`
