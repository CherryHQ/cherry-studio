import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, isMac } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useOcrProviders } from '@renderer/hooks/useOcr'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, PreprocessProvider } from '@renderer/types'
import { Alert, Input, InputNumber, Menu, Modal, Select, Slider, Tooltip } from 'antd'
import { sortBy } from 'lodash'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  base: KnowledgeBase
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ base: _base, resolve }) => {
  const { preprocessProviders } = usePreprocessProviders()
  const { ocrProviders } = useOcrProviders()

  const [selectedProvider, setSelectedProvider] = useState<PreprocessProvider | undefined>(
    _base.preprocessOrOcrProvider?.provider
  )

  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { base, updateKnowledgeBase } = useKnowledge(_base.id)
  const [newBase, setNewBase] = useState<KnowledgeBase>(_base)
  const [selectedMenu, setSelectedMenu] = useState('general')

  if (!base) {
    resolve(null)
    return null
  }

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((model) => isEmbeddingModel(model))
        .map((m) => ({
          label: m.name,
          value: getModelUniqId(m)
        }))
    }))
    .filter((group) => group.options.length > 0)

  const rerankSelectOptions = providers
    .filter((p) => p.models.length > 0)
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

  const preprocessOptions = {
    label: t('settings.tool.preprocess.provider'),
    title: t('settings.tool.preprocess.provider'),
    options: preprocessProviders
      // todo: 免费期结束后删除
      .filter((p) => p.apiKey !== '' || p.id === 'mineru')
      .map((p) => ({ value: p.id, label: p.name }))
  }
  const ocrOptions = {
    label: t('settings.tool.ocr.provider'),
    title: t('settings.tool.ocr.provider'),
    options: ocrProviders.filter((p) => p.apiKey !== '').map((p) => ({ value: p.id, label: p.name }))
  }

  const preprocessOrOcrSelectOptions = [
    ...(preprocessOptions.options.length > 0 ? [preprocessOptions] : []),
    ...(isMac && ocrOptions.options.length > 0 ? [ocrOptions] : [])
  ]

  const onOk = async () => {
    try {
      console.log('newbase', newBase)
      updateKnowledgeBase(newBase)
      setOpen(false)
      resolve(newBase)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const menuItems = [
    {
      key: 'general',
      label: t('settings.general')
    },
    {
      key: 'advanced',
      label: t('settings.advanced.title')
    }
  ]

  const renderSettings = () => {
    if (selectedMenu === 'general') {
      return (
        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">{t('common.name')}</div>
            <Input
              placeholder={t('common.name')}
              defaultValue={base.name}
              onChange={(e) => setNewBase({ ...newBase, name: e.target.value })}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('settings.tool.preprocess.title')} / {t('settings.tool.ocr.title')}
              <Tooltip title={t('settings.tool.preprocessOrOcr.tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <Select
              value={selectedProvider?.id}
              style={{ width: '100%' }}
              onChange={(value: string) => {
                const type = preprocessProviders.find((p) => p.id === value) ? 'preprocess' : 'ocr'
                const provider = (type === 'preprocess' ? preprocessProviders : ocrProviders).find(
                  (p) => p.id === value
                )
                if (!provider) {
                  setSelectedProvider(undefined)
                  setNewBase({
                    ...newBase,
                    preprocessOrOcrProvider: undefined
                  })
                  return
                }
                setSelectedProvider(provider)
                setNewBase({
                  ...newBase,
                  preprocessOrOcrProvider: {
                    type: type,
                    provider: provider
                  }
                })
              }}
              placeholder={t('settings.tool.preprocess.provider_placeholder')}
              options={preprocessOrOcrSelectOptions}
              allowClear
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('models.embedding_model')}
              <Tooltip title={t('models.embedding_model_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <Select
              style={{ width: '100%' }}
              options={selectOptions}
              placeholder={t('settings.models.empty')}
              defaultValue={getModelUniqId(base.model)}
              disabled
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('models.rerank_model')}
              <Tooltip title={t('models.rerank_model_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <Select
              style={{ width: '100%' }}
              defaultValue={getModelUniqId(base.rerankModel) || undefined}
              options={rerankSelectOptions}
              placeholder={t('settings.models.empty')}
              onChange={(value) => {
                const rerankModel = value
                  ? providers.flatMap((p) => p.models).find((m) => getModelUniqId(m) === value)
                  : undefined
                setNewBase({ ...newBase, rerankModel })
              }}
              allowClear
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.document_count')}
              <Tooltip title={t('knowledge.document_count_help')}>
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <Slider
              style={{ width: '100%' }}
              min={1}
              max={30}
              step={1}
              defaultValue={base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT}
              marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30' }}
              onChange={(value) => setNewBase({ ...newBase, documentCount: value })}
            />
          </SettingsItem>
        </SettingsPanel>
      )
    }
    if (selectedMenu === 'advanced') {
      return (
        <SettingsPanel>
          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.chunk_size')}
              <Tooltip title={t('knowledge.chunk_size_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              min={100}
              value={base.chunkSize}
              placeholder={t('knowledge.chunk_size_placeholder')}
              onChange={(value) => {
                const maxContext = getEmbeddingMaxContext(base.model.id)
                if (!value || !maxContext || value <= maxContext) {
                  setNewBase({ ...newBase, chunkSize: value || undefined })
                }
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.chunk_overlap')}
              <Tooltip title={t('knowledge.chunk_overlap_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              value={base.chunkOverlap}
              placeholder={t('knowledge.chunk_overlap_placeholder')}
              onChange={async (value) => {
                if (!value || (newBase.chunkSize && newBase.chunkSize > value)) {
                  setNewBase({ ...newBase, chunkOverlap: value || undefined })
                }
                await window.message.error(t('message.error.chunk_overlap_too_large'))
              }}
            />
          </SettingsItem>

          <SettingsItem>
            <div className="settings-label">
              {t('knowledge.threshold')}
              <Tooltip title={t('knowledge.threshold_tooltip')} placement="right">
                <InfoCircleOutlined style={{ marginLeft: 8, color: 'var(--color-text-3)' }} />
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              step={0.1}
              min={0}
              max={1}
              value={base.threshold}
              placeholder={t('knowledge.threshold_placeholder')}
              onChange={(value) => setNewBase({ ...newBase, threshold: value || undefined })}
            />
          </SettingsItem>

          <Alert
            message={t('knowledge.chunk_size_change_warning')}
            type="warning"
            showIcon
            icon={<WarningOutlined />}
          />
        </SettingsPanel>
      )
    }
    return null
  }

  KnowledgeSettings.hide = onCancel

  return (
    <SettingsModal
      title={t('knowledge.settings.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      maskClosable={false}
      centered
      transitionName="animation-move-down"
      width="min(800px, 70vw)"
      styles={{
        body: { padding: 0, height: 450 },
        header: {
          padding: '10px 15px',
          borderBottom: '0.5px solid var(--color-border)',
          margin: 0,
          borderRadius: 0
        },
        content: {
          padding: 0,
          paddingBottom: 10,
          overflow: 'hidden'
        }
      }}>
      <HStack height="100%">
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={['general']}
            mode="vertical"
            items={menuItems}
            onSelect={({ key }) => setSelectedMenu(key)}
          />
        </LeftMenu>
        <SettingsContentPanel>{renderSettings()}</SettingsContentPanel>
      </HStack>
    </SettingsModal>
  )
}

const TopViewKey = 'KnowledgeSettingsPopup'

const SettingsPanel = styled.div`
  padding: 0 16px;
`

const SettingsItem = styled.div`
  margin-bottom: 24px;

  .settings-label {
    font-size: 14px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
  }
`
const SettingsModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
  .ant-menu-item {
    height: 36px;
    color: var(--color-text-2);
    display: flex;
    align-items: center;
    border: 0.5px solid transparent;
    border-radius: 6px;
    .ant-menu-title-content {
      line-height: 36px;
    }
  }
  .ant-menu-item-active {
    background-color: var(--color-background-soft) !important;
    transition: none;
  }
  .ant-menu-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .ant-menu-title-content {
      color: var(--color-text-1);
      font-weight: 500;
    }
  }
`

const LeftMenu = styled.div`
  display: flex;
  height: 100%;
  border-right: 0.5px solid var(--color-border);
`

const SettingsContentPanel = styled.div`
  flex: 1;
  padding: 16px 16px;
  overflow-y: scroll;
`

const StyledMenu = styled(Menu)`
  width: 200px;
  padding: 5px;
  background: transparent;
  margin-top: 2px;
  border-inline-end: none !important;
  .ant-menu-item {
    margin-bottom: 7px;
  }
`

export default class KnowledgeSettings {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
