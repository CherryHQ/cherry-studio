import LanguageSelect from '@renderer/components/LanguageSelect'
import { HStack } from '@renderer/components/Layout'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { Model, TranslateLanguage } from '@renderer/types'
import { Button, Flex, Modal, Space, Switch, Tooltip } from 'antd'
import { HelpCircle } from 'lucide-react'
import { FC, memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateSettingsPopup from '../settings/TranslateSettingsPopup/TranslateSettingsPopup'

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
  setBidirectionalPair
}) => {
  const { t } = useTranslation()
  const [localPair, setLocalPair] = useState<[TranslateLanguage, TranslateLanguage]>(bidirectionalPair)
  const { getLanguageByLangcode } = useTranslate()

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
      width={420}
      transitionName="animation-move-down">
      <Flex vertical gap={16} style={{ marginTop: 16, paddingBottom: 20 }}>
        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.preview')}</div>
            <Switch
              checked={enableMarkdown}
              onChange={(checked) => {
                setEnableMarkdown(checked)
                db.settings.put({ id: 'translate:markdown:enabled', value: checked })
              }}
            />
          </Flex>
        </div>

        <div>
          <Flex align="center" justify="space-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.scroll_sync')}</div>
            <Switch
              checked={isScrollSyncEnabled}
              onChange={(checked) => {
                setIsScrollSyncEnabled(checked)
                db.settings.put({ id: 'translate:scroll:sync', value: checked })
              }}
            />
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
            <Switch
              checked={isBidirectional}
              onChange={(checked) => {
                setIsBidirectional(checked)
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
                      window.message.warning({
                        content: t('translate.language.same'),
                        key: 'translate-message'
                      })
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
                      window.message.warning({
                        content: t('translate.language.same'),
                        key: 'translate-message'
                      })
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
