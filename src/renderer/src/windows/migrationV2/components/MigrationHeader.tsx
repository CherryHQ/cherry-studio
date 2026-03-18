import { Button } from '@cherrystudio/ui'
import { AppLogo } from '@renderer/config/env'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import { X } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { StageIndicator } from './StageIndicator'

interface Props {
  stage: MigrationStage
  canClose: boolean
  onClose: () => void
}

export const MigrationHeader: React.FC<Props> = ({ stage, canClose, onClose }) => {
  const { t } = useTranslation()

  return (
    <header className="border-black/8 border-b">
      <div className="drag relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
        <div className="nodrag flex min-w-0 items-center gap-3">
          <img src={AppLogo} alt="" className="size-10 rounded-xl" />
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-semibold text-foreground text-sm">{t('migration.title')}</h2>
            <span className="truncate text-muted-foreground text-xs">{t('migration.header.meta')}</span>
          </div>
        </div>
        <div className="nodrag -translate-y-1/2 pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
          <div className="pointer-events-auto">
            <StageIndicator stage={stage} />
          </div>
        </div>
        <div className="nodrag flex justify-end">
          <Button
            aria-label={t('migration.buttons.close')}
            variant="ghost"
            size="icon-sm"
            className="rounded-md text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
            disabled={!canClose}
            onClick={onClose}>
            <X className="lucide-custom size-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
