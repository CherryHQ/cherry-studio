import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { Tag } from 'antd'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const QuotaTag: FC<{ providerId: string; quota?: number }> = ({ providerId, quota }) => {
  const { t } = useTranslation()
  const { provider, updatePreprocessProvider } = usePreprocessProvider(providerId)

  useEffect(() => {
    if (quota) {
      updatePreprocessProvider({ ...provider, quota })
    }
  }, [quota])

  return (
    <>
      {provider.quota && (
        <Tag color="orange" style={{ borderRadius: 20, margin: 0 }}>
          {t('knowledge.quota', {
            name: provider.name,
            quota: provider.quota
          })}
        </Tag>
      )}
    </>
  )
}

export default QuotaTag
