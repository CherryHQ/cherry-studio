import { Radio, RadioGroup, Switch, Tooltip } from '@heroui/react'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { ColFlex, Flex, RowFlex } from '@renderer/components/Layout'
import HelpTooltip from '@renderer/components/TooltipIcons/HelpTooltip'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { AutoDetectionMethod, Model, TranslateLanguage } from '@renderer/types'
import { Button, Modal, Space } from 'antd'
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
      <ColFlex className="mt-4 gap-4 pb-5">
        <div>
          <Flex className="items-center justify-between">
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
          <RowFlex className="items-center justify-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.autoCopy')}</div>
            <Switch
              isSelected={autoCopy}
              color="primary"
              onValueChange={(isSelected) => {
                updateSettings({ autoCopy: isSelected })
              }}
            />
          </RowFlex>
        </div>

        <div>
          <Flex className="items-center justify-between">
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

        <RowFlex className="justify-between">
          <RowFlex className="items-center gap-[5px]">
            {t('translate.detect.method.label')}
            <HelpTooltip content={t('translate.detect.method.tip')} />
          </RowFlex>
          <RowFlex className="items-center gap-[5px]">
            <RadioGroup
              value={autoDetectionMethod}
              onValueChange={(value) => {
                setAutoDetectionMethod(value as AutoDetectionMethod)
              }}
              orientation="horizontal"
              size="sm">
              <Tooltip content={t('translate.detect.method.auto.tip')} showArrow={true}>
                <Radio value="auto">{t('translate.detect.method.auto.label')}</Radio>
              </Tooltip>
              <Tooltip content={t('translate.detect.method.algo.tip')} showArrow={true}>
                <Radio value="franc">{t('translate.detect.method.algo.label')}</Radio>
              </Tooltip>
              <Tooltip content={t('translate.detect.method.llm.tip')} showArrow={true}>
                <Radio value="llm">LLM</Radio>
              </Tooltip>
            </RadioGroup>
          </RowFlex>
        </RowFlex>

        <div>
          <Flex className="items-center justify-between">
            <RowFlex className="items-center gap-[5px]">
              {t('translate.settings.bidirectional')}
              <HelpTooltip content={t('translate.settings.bidirectional_tip')} />
            </RowFlex>
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
              <Flex className="items-center justify-between gap-2.5">
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
      </ColFlex>
    </Modal>
  )
}

export default memo(TranslateSettings)
