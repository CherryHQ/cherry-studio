import { loggerService } from '@logger'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { KnowledgeBase } from '@renderer/types'
import { Tag } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('QuotaTag')

const QuotaTag: FC<{ base: KnowledgeBase; providerId: string; quota?: number }> = ({
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
        setQuota(-9999)
        updateProvider({ quota: -9999 })
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
      updateProvider({ quota: _quota })
      return
    }
    checkQuota()
  }, [_quota, base, provider.id, provider.apiKey, provider, quota, updateProvider])

  return (
    <>
      {quota && (
        <Tag color="orange" style={{ borderRadius: 20, margin: 0 }}>
          {quota === -9999
            ? t('knowledge.quota_infinity', {
                name: provider.name
              })
            : t('knowledge.quota', {
                name: provider.name,
                quota: quota
              })}
        </Tag>
      )}
    </>
  )
}

export default QuotaTag
