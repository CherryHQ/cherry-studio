import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { Activity, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { actionClasses } from './ProviderSettingsPrimitives'

interface ApiActionsProps {
  providerId: string
  onCheckConnection: () => void
  onOpenApiKeyList: () => void
}

export default function ApiActions({ providerId, onCheckConnection, onOpenApiKeyList }: ApiActionsProps) {
  const { t } = useTranslation()
  const meta = useProviderMeta(providerId)

  return (
    <div className={actionClasses.row}>
      <Button
        variant="outline"
        size="sm"
        className={cn(actionClasses.btnBase, actionClasses.btnNeutral)}
        onClick={() => void onCheckConnection()}>
        <Activity className={actionClasses.icon} />
        {t('settings.provider.check')}
      </Button>
      {meta.isApiKeyFieldVisible && (
        <Button
          variant="outline"
          size="sm"
          className={cn(actionClasses.btnBase, actionClasses.btnNeutral)}
          onClick={onOpenApiKeyList}>
          <KeyRound className={actionClasses.icon} />
          {t('settings.provider.api.key.list.title')}
        </Button>
      )}
    </div>
  )
}
