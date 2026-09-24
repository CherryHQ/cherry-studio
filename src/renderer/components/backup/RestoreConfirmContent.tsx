import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert } from '@cherrystudio/ui'
import type { OutputFor } from '@shared/ipc/types'

import { DegradationDetails } from './DegradationDetails'

export type RestorePreview = Extract<OutputFor<'backup.prepare_restore'>, { status: 'prepared' }>['preview']

/**
 * The body of the "replace all data?" confirmation, whichever surface asks it:
 * the one destructive sentence, plus whatever the prepared preview says this
 * archive will cost or leave out on this device.
 */
export const RestoreConfirmContent: FC<{ preview: RestorePreview }> = ({ preview }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>{t('settings.data.backup.restore.confirm_content')}</p>
      {preview.knowledge.ready > 0 && (
        <p className="text-muted-foreground">
          {t('settings.data.backup.preview.knowledge_ready', { count: preview.knowledge.ready })}
        </p>
      )}
      {preview.knowledge.rebuild > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('settings.data.backup.preview.knowledge_rebuild_cost', {
            count: preview.knowledge.rebuild
          })}
        />
      )}
      {preview.degradations.length > 0 && (
        <div className="text-muted-foreground">
          <DegradationDetails
            degradations={preview.degradations}
            consequenceKey="settings.data.backup.preview.degradations"
          />
        </div>
      )}
    </div>
  )
}
