import { RedoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { translateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Language, Model } from '@renderer/types'
import { getLanguageByLangcode } from '@renderer/utils/translate'
import { Button, Flex, Input, Modal, Select, Space, Switch, Tooltip } from 'antd'
import { find } from 'lodash'
import { ChevronDown, HelpCircle, TriangleAlert } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TranslateSettings: FC<{
  visible: boolean
  onClose: () => void
  isScrollSyncEnabled: boolean
  setIsScrollSyncEnabled: (value: boolean) => void
  isBidirectional: boolean
  setIsBidirectional: (value: boolean) => void
  enableMarkdown: boolean
  setEnableMarkdown: (value: boolean) => void
  bidirectionalPair: [Language, Language]
  setBidirectionalPair: (value: [Language, Language]) => void
  translateModel: Model | undefined
  onModelChange: (model: Model) => void
}> = ({
  visible,
  onClose,
  isScrollSyncEnabled,
  setIsScrollSyncEnabled,
  isBidirectional,
  setIsBidirectional,
  enableMarkdown,
  setEnableMarkdown,
  bidirectionalPair,
  setBidirectionalPair,
  translateModel,
  onModelChange
}) => {
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()
  const dispatch = useAppDispatch()
  const [localPair, setLocalPair] = useState<[Language, Language]>(bidirectionalPair)
  const [showPrompt, setShowPrompt] = useState(false)
  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const { providers } = useProviders()
  const allModels = useMemo(() => providers.map((p) => p.models).flat(), [providers])

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  useEffect(() => {
    setLocalPair(bidirectionalPair)
    setLocalPrompt(translateModelPrompt)
  }, [bidirectionalPair, translateModelPrompt, visible])

  const handleSave = () => {
    if (localPair[0] === localPair[1]) {
      window.message.warning({
        content: t('translate.language.same'),
        key: 'translate-message'
      })
      return
    }
    setBidirectionalPair(localPair)
    db.settings.put({ id: 'translate:bidirectional:pair', value: [localPair[0].langCode, localPair[1].langCode] })
    db.settings.put({ id: 'translate:scroll:sync', value: isScrollSyncEnabled })
    db.settings.put({ id: 'translate:markdown:enabled', value: enableMarkdown })
    db.settings.put({ id: 'translate:model:prompt', value: localPrompt })
    dispatch(setTranslateModelPrompt(localPrompt))
    window.message.success({
      content: t('message.save.success.title'),
      key: 'translate-settings-save'
    })
    onClose()
  }

  return (
    <Modal
      title={<div style={{ fontSize: 16 }}>{t('translate.settings.title')}</div>}
      open={visible}
      onCancel={onClose}
      centered={true}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          {t('common.save')}
        </Button>
      ]}
      width={420}>
      <Flex vertical gap={16} style={{ marginTop: 16 }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center' }}>
            {t('translate.settings.model')}
            <Tooltip title={t('translate.settings.model_desc')}>
              <span style={{ marginLeft: 4, display: 'flex', alignItems: 'center' }}>
                <HelpCircle size={14} style={{ color: 'var(--color-text-3)' }} />
              </span>
            </Tooltip>
          </div>
          <HStack alignItems="center" gap={5}>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              style={{ width: '100%' }}
              value={defaultTranslateModel}
              placeholder={t('settings.models.empty')}
              onChange={(value) => {
                const selectedModel = find(allModels, JSON.parse(value)) as Model
                if (selectedModel) {
                  onModelChange(selectedModel)
                }
              }}
            />
          </HStack>
          {!translateModel && (
            <div style={{ marginTop: 8, color: 'var(--color-warning)' }}>
              <HStack alignItems="center" gap={5}>
                <TriangleAlert size={14} />
                <span style={{ fontSize: 12 }}>{t('translate.settings.no_model_warning')}</span>
              </HStack>
            </div>
          )}
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.preview')}</div>
            <Switch checked={enableMarkdown} onChange={setEnableMarkdown} />
          </Flex>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.scroll_sync')}</div>
            <Switch checked={isScrollSyncEnabled} onChange={setIsScrollSyncEnabled} />
          </Flex>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>
              <HStack alignItems="center" gap={5}>
                {t('translate.settings.bidirectional')}
                <Tooltip title={t('translate.settings.bidirectional_tip')}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <HelpCircle size={14} style={{ color: 'var(--color-text-3)' }} />
                  </span>
                </Tooltip>
              </HStack>
            </div>
            <Switch checked={isBidirectional} onChange={setIsBidirectional} />
          </Flex>
          {isBidirectional && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Flex align="center" justify="space-between" gap={10}>
                <Select
                  style={{ flex: 1 }}
                  value={localPair[0].langCode}
                  onChange={(value) => setLocalPair([getLanguageByLangcode(value), localPair[1]])}
                  options={translateLanguageOptions.map((lang) => ({
                    value: lang.langCode,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <Space.Compact block>{lang.label()}</Space.Compact>
                      </Space.Compact>
                    )
                  }))}
                />
                <span>⇆</span>
                <Select
                  style={{ flex: 1 }}
                  value={localPair[1].langCode}
                  onChange={(value) => setLocalPair([localPair[0], getLanguageByLangcode(value)])}
                  options={translateLanguageOptions.map((lang) => ({
                    value: lang.langCode,
                    label: (
                      <Space.Compact direction="horizontal" block>
                        <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
                          {lang.emoji}
                        </span>
                        <div style={{ textAlign: 'left', flex: 1 }}>{lang.label()}</div>
                      </Space.Compact>
                    )
                  }))}
                />
              </Flex>
            </Space>
          )}
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div
              style={{
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer'
              }}
              onClick={() => setShowPrompt(!showPrompt)}>
              {t('settings.models.translate_model_prompt_title')}
              <ChevronDown
                size={16}
                style={{
                  transform: showPrompt ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.3s',
                  marginLeft: 5
                }}
              />
            </div>
            {localPrompt !== TRANSLATE_PROMPT && (
              <Tooltip title={t('common.reset')}>
                <Button
                  icon={<RedoOutlined />}
                  size="small"
                  type="text"
                  onClick={() => setLocalPrompt(TRANSLATE_PROMPT)}
                />
              </Tooltip>
            )}
          </Flex>
        </div>

        <div style={{ display: showPrompt ? 'block' : 'none' }}>
          <Input.TextArea
            rows={8}
            value={localPrompt}
            onChange={(e) => setLocalPrompt(e.target.value)}
            placeholder={t('settings.models.translate_model_prompt_message')}
            style={{ borderRadius: '8px' }}
          />
        </div>
      </Flex>
    </Modal>
  )
}

export default memo(TranslateSettings)
