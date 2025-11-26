import { loggerService } from '@logger'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import type { KnowledgeBase, PreprocessProviderId } from '@renderer/types'
import { Tag } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('QuotaTag')

const QUOTA_UNLIMITED = -9999

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
      if (provider.id !== 'mineru') return
      // 使用用户的key时quota为无限
      if (provider.apiKey) {
        setQuota(QUOTA_UNLIMITED)
        updateProvider({ quota: QUOTA_UNLIMITED })
        return
      }
      if (quota === undefined) {
        const userId = getStoreSetting('userId')
        const baseParams = getKnowledgeBaseParams(base)
        try {
          const response = await window.api.knowledgeBase.checkQuota({
            base: baseParams,
            userId: userId as string
          })
          setQuota(response)
        } catch (error) {
          logger.error('[KnowledgeContent] Error checking quota:', error as Error)
        }
      }
    }
    if (_quota !== undefined) {
      setQuota(_quota)
      updateProvider({ quota: _quota })
      return
    }
    checkQuota()
  }, [_quota, base, provider.id, provider.apiKey, provider, quota, updateProvider])

  const getQuotaDisplay = () => {
    if (quota === undefined) return null
    if (quota === QUOTA_UNLIMITED) {
      return (
        <Tag color="orange" style={{ borderRadius: 20, margin: 0 }}>
          {t('knowledge.quota_infinity', { name: provider.name })}
        </Tag>
      )
    }
    if (quota === 0) {
      return (
        <Tag color="red" style={{ borderRadius: 20, margin: 0 }}>
          {t('knowledge.quota_empty', { name: provider.name })}
        </Tag>
      )
    }
    return (
      <Tag color="orange" style={{ borderRadius: 20, margin: 0 }}>
        {t('knowledge.quota', { name: provider.name, quota: quota })}
      </Tag>
    )
  }

  return <>{getQuotaDisplay()}</>
}

export default QuotaTag
