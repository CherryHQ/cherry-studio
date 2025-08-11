import { RedoOutlined } from '@ant-design/icons'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { HStack } from '@renderer/components/Layout'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import db from '@renderer/databases'
import { useSettings } from '@renderer/hooks/useSettings'
import useTranslate from '@renderer/hooks/useTranslate'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { AutoDetectionMethod, Model, TranslateLanguage } from '@renderer/types'
import { Button, Flex, Input, Modal, Radio, Space, Switch, Tooltip } from 'antd'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { Dispatch, FC, memo, SetStateAction, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const TranslateSettings: FC<{
  visible: boolean
  onClose: () => void
  isScrollSyncEnabled: boolean
  setIsScrollSyncEnabled: (value: boolean) => void
  isBidirectional: boolean
  setIsBidirectional: (value: boolean) => void
  enableMarkdown: boolean
  setEnableMarkdown: (value: boolean) => void
  bidirectionalPair: [TranslateLanguage, TranslateLanguage]
  setBidirectionalPair: (value: [TranslateLanguage, TranslateLanguage]) => void
  translateModel: Model | undefined
  autoDetectionMethod: AutoDetectionMethod
  setAutoDetectionMethod: Dispatch<SetStateAction<AutoDetectionMethod>>
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
  autoDetectionMethod,
  setAutoDetectionMethod
}) => {
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()
  const dispatch = useAppDispatch()
  const [localPair, setLocalPair] = useState<[TranslateLanguage, TranslateLanguage]>(bidirectionalPair)
  const [showPrompt, setShowPrompt] = useState(false)
  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const { getLanguageByLangcode } = useTranslate()

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
      ]}>
      <Flex vertical gap={16} style={{ marginTop: 16, padding: '8px 0' }}>
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
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={localPair[0].langCode}
                  onChange={(value) => setLocalPair([getLanguageByLangcode(value), localPair[1]])}
                />
                <span>⇆</span>
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={localPair[1].langCode}
                  onChange={(value) => setLocalPair([localPair[0], getLanguageByLangcode(value)])}
                />
              </Flex>
            </Space>
          )}
        </div>

        <HStack style={{ justifyContent: 'space-between' }}>
          <div style={{ marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center' }}>
            {t('translate.detect.method.label')}
            <Tooltip title={t('translate.detect.method.tip')}>
              <span style={{ marginLeft: 4, display: 'flex', alignItems: 'center' }}>
                <HelpCircle size={14} style={{ color: 'var(--color-text-3)' }} />
              </span>
            </Tooltip>
          </div>
          <HStack alignItems="center" gap={5}>
            <Radio.Group
              defaultValue={'auto'}
              value={autoDetectionMethod}
              optionType="button"
              buttonStyle="solid"
              onChange={(e) => {
                setAutoDetectionMethod(e.target.value)
              }}>
              <Tooltip title={t('translate.detect.method.auto.tip')}>
                <Radio.Button value="auto">{t('translate.detect.method.auto.label')}</Radio.Button>
              </Tooltip>
              <Tooltip title={t('translate.detect.method.algo.tip')}>
                <Radio.Button value="franc">{t('translate.detect.method.algo.label')}</Radio.Button>
              </Tooltip>
              <Tooltip title={t('translate.detect.method.llm.tip')}>
                <Radio.Button value="llm">LLM</Radio.Button>
              </Tooltip>
            </Radio.Group>
          </HStack>
        </HStack>

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

        {showPrompt && (
          <div>
            <Textarea
              rows={8}
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              placeholder={t('settings.models.translate_model_prompt_message')}
              style={{ borderRadius: '8px' }}
            />
          </div>
        )}
      </Flex>
    </Modal>
  )
}

export default memo(TranslateSettings)

const Textarea = styled(Input.TextArea)`
  display: flex;
  flex: 1;
  font-size: 16px;
  border-radius: 0;
  .ant-input {
    resize: none;
    padding: 5px 16px;
  }
  .ant-input-clear-icon {
    font-size: 16px;
  }
`
