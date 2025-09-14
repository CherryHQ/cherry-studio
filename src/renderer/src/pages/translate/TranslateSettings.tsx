import { Switch } from '@heroui/react'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { HStack } from '@renderer/components/Layout'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { AutoDetectionMethod, Model, TranslateLanguage } from '@renderer/types'
import { Button, Flex, Modal, Radio, Space, Tooltip } from 'antd'
import { HelpCircle } from 'lucide-react'
import { FC, memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateSettingsPopup from '../settings/TranslateSettingsPopup/TranslateSettingsPopup'

// TODO: Just don't send so many props. Migrate them to redux.
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
  setAutoDetectionMethod: (method: AutoDetectionMethod) => void
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
  const [localPair, setLocalPair] = useState<[TranslateLanguage, TranslateLanguage]>(bidirectionalPair)
  const { getLanguageByLangcode, settings, updateSettings } = useTranslate()
  const { autoCopy } = settings

  useEffect(() => {
    setLocalPair(bidirectionalPair)
  }, [bidirectionalPair, visible])

  const onMoreSetting = () => {
    onClose()
    TranslateSettingsPopup.show()
  }

  return (
    <Modal
      title={<div style={{ fontSize: 16 }}>{t('translate.settings.title')}</div>}
      open={visible}
      onCancel={onClose}
      centered={true}
      footer={null}
      width={520}
      transitionName="animation-move-down">
      <Flex vertical gap={16} style={{ marginTop: 16, paddingBottom: 20 }}>
        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.preview')}</div>
            <Switch
              isSelected={enableMarkdown}
              onValueChange={(checked) => {
                setEnableMarkdown(checked)
                db.settings.put({ id: 'translate:markdown:enabled', value: checked })
              }}
            />
          </Flex>
        </div>

        <div>
          <HStack alignItems="center" justifyContent="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.autoCopy')}</div>
            <Switch
              isSelected={autoCopy}
              color="primary"
              onValueChange={(isSelected) => {
                updateSettings({ autoCopy: isSelected })
              }}
            />
          </HStack>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.scroll_sync')}</div>
            <Switch
              isSelected={isScrollSyncEnabled}
              color="primary"
              onValueChange={(isSelected) => {
                setIsScrollSyncEnabled(isSelected)
                db.settings.put({ id: 'translate:scroll:sync', value: isSelected })
              }}
            />
          </Flex>
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
            <Switch
              isSelected={isBidirectional}
              color="primary"
              onValueChange={(isSelected) => {
                setIsBidirectional(isSelected)
                // 双向翻译设置不需要持久化，它只是界面状态
              }}
            />
          </Flex>
          {isBidirectional && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Flex align="center" justify="space-between" gap={10}>
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={localPair[0].langCode}
                  onChange={(value) => {
                    const newPair: [TranslateLanguage, TranslateLanguage] = [getLanguageByLangcode(value), localPair[1]]
                    if (newPair[0] === newPair[1]) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    setLocalPair(newPair)
                    setBidirectionalPair(newPair)
                    db.settings.put({
                      id: 'translate:bidirectional:pair',
                      value: [newPair[0].langCode, newPair[1].langCode]
                    })
                  }}
                />
                <span>⇆</span>
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={localPair[1].langCode}
                  onChange={(value) => {
                    const newPair: [TranslateLanguage, TranslateLanguage] = [localPair[0], getLanguageByLangcode(value)]
                    if (newPair[0] === newPair[1]) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    setLocalPair(newPair)
                    setBidirectionalPair(newPair)
                    db.settings.put({
                      id: 'translate:bidirectional:pair',
                      value: [newPair[0].langCode, newPair[1].langCode]
                    })
                  }}
                />
              </Flex>
            </Space>
          )}
        </div>
        <Button onClick={onMoreSetting}>{t('settings.moresetting.label')}</Button>
      </Flex>
    </Modal>
  )
}

export default memo(TranslateSettings)
