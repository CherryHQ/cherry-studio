import AiProvider from '@renderer/aiCore'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import Logger from '@renderer/config/logger'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { NOT_SUPPORTED_REANK_PROVIDERS } from '@renderer/config/providers'
import { useProviders } from '@renderer/hooks/useProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearchProviders'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Button, InputNumber, Select, Slider, Tooltip } from 'antd'
import { find, sortBy } from 'lodash'
import { Info, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const INPUT_BOX_WIDTH = '200px'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { compressionConfig, updateCompressionConfig } = useWebSearchSettings()
  const [loadingDimensions, setLoadingDimensions] = useState(false)

  const embeddingModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isEmbeddingModel(model))
  }, [providers])

  const rerankModels = useMemo(() => {
    return providers
      .map((p) => p.models)
      .flat()
      .filter((model) => isRerankModel(model))
  }, [providers])

  const embeddingSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        label: p.isSystem ? t(`provider.${p.id}`) : p.name,
        title: p.name,
        options: sortBy(p.models, 'name')
          .filter((model) => isEmbeddingModel(model))
          .map((m) => ({
            label: m.name,
            value: getModelUniqId(m),
            providerId: p.id,
            modelId: m.id
          }))
      }))
      .filter((group) => group.options.length > 0)
  }, [providers, t])

  const rerankSelectOptions = useMemo(() => {
    return providers
      .filter((p) => p.models.length > 0)
      .filter((p) => !NOT_SUPPORTED_REANK_PROVIDERS.includes(p.id))
      .map((p) => ({
        label: p.isSystem ? t(`provider.${p.id}`) : p.name,
        title: p.name,
        options: sortBy(p.models, 'name')
          .filter((model) => isRerankModel(model))
          .map((m) => ({
            label: m.name,
            value: getModelUniqId(m)
          }))
      }))
      .filter((group) => group.options.length > 0)
  }, [providers, t])

  const compressionMethodOptions = [
    { value: 'none', label: t('settings.websearch.compression.method.none') },
    { value: 'rag', label: t('settings.websearch.compression.method.rag') }
  ]

  const isRagMethod = compressionConfig?.method === 'rag'

  const handleCompressionMethodChange = (method: 'none' | 'rag') => {
    updateCompressionConfig({ method })
  }

  const handleEmbeddingModelChange = (modelValue: string) => {
    const selectedModel = find(embeddingModels, JSON.parse(modelValue)) as Model
    updateCompressionConfig({ embeddingModel: selectedModel })
  }

  const handleRerankModelChange = (modelValue?: string) => {
    const selectedModel = modelValue ? (find(rerankModels, JSON.parse(modelValue)) as Model) : undefined
    updateCompressionConfig({ rerankModel: selectedModel })
  }

  const handleEmbeddingDimensionsChange = (value: number | null) => {
    updateCompressionConfig({ embeddingDimensions: value || undefined })
  }

  const handleDocumentCountChange = (value: number) => {
    updateCompressionConfig({ documentCount: value })
  }

  const handleAutoGetDimensions = async () => {
    if (!compressionConfig?.embeddingModel) {
      Logger.log('[CompressionSettings] handleAutoGetDimensions: no embedding model')
      window.message.error(t('settings.websearch.compression.error.embedding_model_required'))
      return
    }

    const provider = providers.find((p) => p.id === compressionConfig.embeddingModel?.provider)
    if (!provider) {
      Logger.log('[CompressionSettings] handleAutoGetDimensions: provider not found')
      window.message.error(t('settings.websearch.compression.error.provider_not_found'))
      return
    }

    setLoadingDimensions(true)
    try {
      const aiProvider = new AiProvider(provider)
      const dimensions = await aiProvider.getEmbeddingDimensions(compressionConfig.embeddingModel)

      updateCompressionConfig({ embeddingDimensions: dimensions })

      window.message.success(t('settings.websearch.compression.info.dimensions_auto_success', { dimensions }))
    } catch (error) {
      Logger.error('[CompressionSettings] handleAutoGetDimensions: failed to get embedding dimensions', error)
      window.message.error(t('settings.websearch.compression.error.dimensions_auto_failed'))
    } finally {
      setLoadingDimensions(false)
    }
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.websearch.compression.method')}</SettingRowTitle>
        <Select
          value={compressionConfig?.method || 'none'}
          style={{ width: INPUT_BOX_WIDTH }}
          onChange={handleCompressionMethodChange}
          options={compressionMethodOptions}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('models.embedding_model')}</SettingRowTitle>
        <Select
          value={compressionConfig?.embeddingModel ? getModelUniqId(compressionConfig.embeddingModel) : undefined}
          style={{ width: INPUT_BOX_WIDTH }}
          options={embeddingSelectOptions}
          placeholder={t('settings.models.empty')}
          disabled={!isRagMethod}
          onChange={handleEmbeddingModelChange}
          allowClear={false}
          showSearch
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('models.embedding_dimensions')}</SettingRowTitle>
        <InputNumberWrapper>
          <InputNumber
            value={compressionConfig?.embeddingDimensions}
            style={{ flex: 1 }}
            placeholder={t('settings.websearch.compression.embedding_dimensions.placeholder')}
            min={1}
            disabled={!isRagMethod}
            onChange={handleEmbeddingDimensionsChange}
          />
          <Tooltip title={t('settings.websearch.compression.embedding_dimensions.auto_get')}>
            <Button
              icon={<RefreshCw size={16} />}
              loading={loadingDimensions}
              disabled={!isRagMethod || !compressionConfig?.embeddingModel}
              onClick={handleAutoGetDimensions}
            />
          </Tooltip>
        </InputNumberWrapper>
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('models.rerank_model')}</SettingRowTitle>
        <Select
          value={compressionConfig?.rerankModel ? getModelUniqId(compressionConfig.rerankModel) : undefined}
          style={{ width: INPUT_BOX_WIDTH }}
          options={rerankSelectOptions}
          placeholder={t('settings.models.empty')}
          disabled={!isRagMethod}
          onChange={handleRerankModelChange}
          allowClear
          showSearch
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>
          {t('settings.websearch.compression.document_count')}
          <Tooltip title={t('settings.websearch.compression.document_count.tooltip')} placement="right">
            <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
          </Tooltip>
        </SettingRowTitle>
        <div style={{ width: INPUT_BOX_WIDTH }}>
          <Slider
            value={compressionConfig?.documentCount || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT}
            min={1}
            max={30}
            step={1}
            disabled={!isRagMethod}
            onChange={handleDocumentCountChange}
            marks={{
              1: '1',
              3: t('settings.websearch.compression.document_count.default'),
              15: '15',
              30: '30'
            }}
          />
        </div>
      </SettingRow>
    </SettingGroup>
  )
}

const InputNumberWrapper = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  width: ${INPUT_BOX_WIDTH};
`

export default CompressionSettings
