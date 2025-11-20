/**
 * Action buttons component for migration flow
 */

import { Button } from '@cherrystudio/ui'
import React from 'react'

import type { MigrationStage } from '../types'

interface Props {
  stage: MigrationStage
  onProceedToBackup: () => void
  onConfirmBackup: () => void
  onStartMigration: () => void
  onRetry: () => void
  onCancel: () => void
  onRestart: () => void
  isLoading?: boolean
}

export const ActionButtons: React.FC<Props> = ({
  stage,
  onProceedToBackup,
  onConfirmBackup,
  onStartMigration,
  onRetry,
  onCancel,
  onRestart,
  isLoading = false
}) => {
  switch (stage) {
    case 'introduction':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="default" onClick={onProceedToBackup}>
            下一步
          </Button>
        </div>
      )

    case 'backup_required':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="default" onClick={onConfirmBackup}>
            已完成备份
          </Button>
        </div>
      )

    case 'backup_confirmed':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="default" onClick={onStartMigration} loading={isLoading}>
            开始迁移
          </Button>
        </div>
      )

    case 'migration':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="default" disabled loading>
            迁移中...
          </Button>
        </div>
      )

    case 'completed':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="default" onClick={onRestart} className="bg-green-600 hover:bg-green-700">
            重启应用
          </Button>
        </div>
      )

    case 'error':
      return (
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>
            退出
          </Button>
          <Button variant="default" onClick={onRetry}>
            重试
          </Button>
        </div>
      )

    default:
      return null
  }
}
