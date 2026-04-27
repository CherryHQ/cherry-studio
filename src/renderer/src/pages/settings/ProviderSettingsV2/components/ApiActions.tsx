import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { actionClasses } from './ProviderSettingsPrimitives'

interface ApiActionsProps {
  providerId: string
  onOpenApiKeyList: () => void
}

export default function ApiActions({ providerId, onOpenApiKeyList }: ApiActionsProps) {
  const { t } = useTranslation()
  const meta = useProviderMeta(providerId)

  if (!meta.isApiKeyFieldVisible) {
    return null
  }

  return (
    <div className={actionClasses.row}>
      <Button
        variant="outline"
        size="sm"
        className={cn(actionClasses.btnBase, actionClasses.btnNeutral)}
        onClick={onOpenApiKeyList}>
        <KeyRound className={actionClasses.icon} />
        {t('settings.provider.api.key.list.title')}
      </Button>
    </div>
  )
}
