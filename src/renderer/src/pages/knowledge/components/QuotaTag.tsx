import { Badge } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import type { KnowledgeBase, PreprocessProviderId } from '@renderer/types'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('QuotaTag')

const QuotaTag: FC<{ base: KnowledgeBase; providerId: PreprocessProviderId; quota?: number }> = ({
  base,
  providerId,
  quota: _quota
}) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = usePreprocessProvider(providerId)
  const [quota, setQuota] = useState<number | undefined>(_quota)

  useEffect(() => {
    const checkQuota = async () => {
      const userId = await preferenceService.get('app.user.id')
      const baseParams = getKnowledgeBaseParams(base)
      try {
        const response = await window.api.knowledgeBase.checkQuota({
          base: baseParams,
          userId: userId as string
        })
        setQuota(response)
        updateProvider({ quota: response })
      } catch (error) {
        logger.error('[KnowledgeContent] Error checking quota:', error as Error)
      }
    }

    if (provider.id !== 'mineru') return
    if (!provider.apiKey) {
      if (quota !== undefined) {
        setQuota(undefined)
        updateProvider({ quota: undefined })
      }
      return
    }
    if (_quota !== undefined) {
      setQuota(_quota)
      updateProvider({ quota: _quota })
      return
    }
    if (quota === undefined) {
      checkQuota()
    }
  }, [_quota, base, provider.id, provider.apiKey, quota, updateProvider])

  const getQuotaDisplay = () => {
    if (quota === undefined) return null
    if (quota === 0) {
      return <Badge variant="destructive">{t('knowledge.quota_empty', { name: provider.name })}</Badge>
    }
    return (
      <Badge className="border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
        {t('knowledge.quota', { name: provider.name, quota: quota })}
      </Badge>
    )
  }

  return <>{getQuotaDisplay()}</>
}

export default QuotaTag
