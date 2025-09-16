import type { LucideIcon } from 'lucide-react'
import { AlertTriangleIcon, CheckIcon, CircleXIcon, InfoIcon } from 'lucide-react'
import React from 'react'

import CustomTag from '../CustomTag'

export type StatusType = 'success' | 'error' | 'warning' | 'info'

export interface StatusTagProps {
  type: StatusType
  message: string
  iconSize?: number
  icon?: React.ReactNode
  color?: string
}

const statusConfig: Record<StatusType, { Icon: LucideIcon; color: string }> = {
  success: { Icon: CheckIcon, color: '#10B981' }, // green-500
  error: { Icon: CircleXIcon, color: '#EF4444' }, // red-500
  warning: { Icon: AlertTriangleIcon, color: '#F59E0B' }, // amber-500
  info: { Icon: InfoIcon, color: '#3B82F6' } // blue-500
}

export const StatusTag: React.FC<StatusTagProps> = ({ type, message, iconSize = 14, icon, color }) => {
  const config = statusConfig[type]
  const Icon = config.Icon
  const finalColor = color || config.color
  const finalIcon = icon || <Icon size={iconSize} color={finalColor} />

  return (
    <CustomTag icon={finalIcon} color={finalColor}>
      {message}
    </CustomTag>
  )
}

// 保留原有的导出以保持向后兼容
export const SuccessTag = ({ iconSize, message }: { iconSize?: number; message: string }) => (
  <StatusTag type="success" iconSize={iconSize} message={message} />
)

export const ErrorTag = ({ iconSize, message }: { iconSize?: number; message: string }) => (
  <StatusTag type="error" iconSize={iconSize} message={message} />
)

export const WarnTag = ({ iconSize, message }: { iconSize?: number; message: string }) => (
  <StatusTag type="warning" iconSize={iconSize} message={message} />
)

export const InfoTag = ({ iconSize, message }: { iconSize?: number; message: string }) => (
  <StatusTag type="info" iconSize={iconSize} message={message} />
)
