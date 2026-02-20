import EmojiIcon from '@renderer/components/EmojiIcon'
import type { ScrollbarProps } from '@renderer/components/Scrollbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { getAgentTypeLabel } from '@renderer/i18n/label'
import type {
  AgentConfiguration,
  AgentEntity,
  AgentSessionEntity,
  GetAgentResponse,
  GetAgentSessionResponse,
  PermissionMode,
  Tool,
  UpdateAgentFunction,
  UpdateAgentSessionFunction
} from '@renderer/types'
import { AgentConfigurationSchema } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { ModalProps } from 'antd'
import { Menu, Modal } from 'antd'
import type { ReactNode } from 'react'
import React from 'react'
import styled from 'styled-components'

import { SettingDivider } from '..'

// Shared types and constants for agent settings
export type AgentConfigurationState = AgentConfiguration & Record<string, unknown>
export const defaultConfiguration: AgentConfigurationState = AgentConfigurationSchema.parse({})

/**
 * Unified props type for settings components that work with both Agent and Session
 */
export type AgentOrSessionSettingsProps =
  | {
      agentBase: GetAgentResponse | undefined | null
      update: UpdateAgentFunction
    }
  | {
      agentBase: GetAgentSessionResponse | undefined | null
      update: UpdateAgentSessionFunction
    }

/**
 * Computes the list of tool IDs that should be automatically approved for a given permission mode.
 */
export const computeModeDefaults = (mode: PermissionMode, tools: Tool[]): string[] => {
  const defaultToolIds = tools.filter((tool) => !tool.requirePermissions).map((tool) => tool.id)
  switch (mode) {
    case 'acceptEdits':
      return [
        ...defaultToolIds,
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'Write',
        'Bash(mkdir:*)',
        'Bash(touch:*)',
        'Bash(rm:*)',
        'Bash(mv:*)',
        'Bash(cp:*)'
      ]
    case 'bypassPermissions':
      return tools.map((tool) => tool.id)
    case 'default':
    case 'plan':
      return defaultToolIds
  }
}

export interface SettingsTitleProps extends React.ComponentPropsWithRef<'div'> {
  contentAfter?: ReactNode
}

export const SettingsTitle: React.FC<SettingsTitleProps> = ({ children, contentAfter }) => {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="flex items-center gap-1 font-bold">{children}</span>
      {contentAfter !== undefined && contentAfter}
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
  hideIcon?: boolean
}

export const AgentLabel: React.FC<AgentLabelProps> = ({ agent, classNames, hideIcon }) => {
  const emoji = agent?.configuration?.avatar

  return (
    <div className={cn('flex w-full items-center gap-2 truncate', classNames?.container)}>
      {!hideIcon && <EmojiIcon emoji={emoji || '⭐️'} className={classNames?.avatar} size={24} />}
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

export const SettingsContainer: React.FC<React.ComponentPropsWithRef<'div'> & ScrollbarProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <Scrollbar className={cn('p-[16px]', className)} {...props}>
      {children}
    </Scrollbar>
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
  min-height: 0;
  overflow: hidden;
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

/**
 * Shared modal styles configuration for settings popups
 */
export const settingsModalStyles: ModalProps['styles'] = {
  content: {
    padding: 0,
    overflow: 'hidden',
    height: '80vh',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    padding: '10px 15px',
    paddingRight: '32px',
    borderBottom: '0.5px solid var(--color-border)',
    margin: 0,
    borderRadius: 0
  },
  body: {
    padding: 0,
    display: 'flex',
    flex: 1
  }
}
