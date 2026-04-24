import { Button, ColFlex, Flex, HelpTooltip, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import LanguageSelect from '@renderer/components/LanguageSelect'
import type { TranslateBidirectionalPair, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { Modal, Radio, Space } from 'antd'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateSettingsPopup from './components/TranslateSettingsPopup/TranslateSettingsPopup'

const TranslateSettings: FC<{
  visible: boolean
  onClose: () => void
}> = ({ visible, onClose }) => {
  const { t } = useTranslation()
  const [pair, setPair] = usePreference('feature.translate.page.bidirectional_pair')
  const [enableMarkdown, setEnableMarkdown] = usePreference('feature.translate.page.enable_markdown')
  const [autoCopy, setAutoCopy] = usePreference('feature.translate.page.auto_copy')
  const [autoDetectionMethod, setAutoDetectionMethod] = usePreference('feature.translate.auto_detection_method')
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = usePreference('feature.translate.page.scroll_sync')
  const [isBidirectional, setIsBidirectional] = usePreference('feature.translate.page.bidirectional_enabled')

  const onMoreSetting = () => {
    onClose()
    void TranslateSettingsPopup.show()
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
              checked={enableMarkdown}
              onCheckedChange={async (isSelected) => {
                return await setEnableMarkdown(isSelected)
              }}
            />
          </Flex>
        </div>

        <div>
          <RowFlex className="items-center justify-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.autoCopy')}</div>
            <Switch
              checked={autoCopy}
              color="primary"
              onCheckedChange={async (isSelected) => {
                return await setAutoCopy(isSelected)
              }}
            />
          </RowFlex>
        </div>

        <div>
          <Flex className="items-center justify-between">
            <div style={{ fontWeight: 500 }}>{t('translate.settings.scroll_sync')}</div>
            <Switch
              checked={isScrollSyncEnabled}
              color="primary"
              onCheckedChange={async (isSelected) => {
                return await setIsScrollSyncEnabled(isSelected)
              }}
            />
          </Flex>
        </div>

        <RowFlex className="justify-between">
          <div style={{ marginBottom: 8, fontWeight: 500, display: 'flex', alignItems: 'center' }}>
            {t('translate.detect.method.label')}
            <HelpTooltip
              content={t('translate.detect.method.tip')}
              iconProps={{ color: 'var(--color-text-3)', className: 'ml-1' }}
            />
          </div>
          <RowFlex className="items-center gap-1.25">
            <Radio.Group
              defaultValue={'auto'}
              value={autoDetectionMethod}
              optionType="button"
              buttonStyle="solid"
              onChange={async (e) => {
                return await setAutoDetectionMethod(e.target.value)
              }}>
              <Tooltip content={t('translate.detect.method.auto.tip')}>
                <Radio.Button value="auto">{t('translate.detect.method.auto.label')}</Radio.Button>
              </Tooltip>
              <Tooltip content={t('translate.detect.method.algo.tip')}>
                <Radio.Button value="franc">{t('translate.detect.method.algo.label')}</Radio.Button>
              </Tooltip>
              <Tooltip content={t('translate.detect.method.llm.tip')}>
                <Radio.Button value="llm">LLM</Radio.Button>
              </Tooltip>
            </Radio.Group>
          </RowFlex>
        </RowFlex>

        <div>
          <Flex className="items-center justify-between">
            <div style={{ fontWeight: 500 }}>
              <RowFlex className="items-center gap-1.25">
                {t('translate.settings.bidirectional')}
                <HelpTooltip
                  content={t('translate.settings.bidirectional_tip')}
                  iconProps={{ className: 'text-text-3' }}
                />
              </RowFlex>
            </div>
            <Switch
              checked={isBidirectional}
              color="primary"
              onCheckedChange={async (isSelected) => {
                return await setIsBidirectional(isSelected)
              }}
            />
          </Flex>
          {isBidirectional && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Flex className="items-center justify-between gap-2.5">
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={pair[0]}
                  onChange={async (value) => {
                    const newPair: TranslateBidirectionalPair = [value, pair[1]]
                    if (newPair[0] === newPair[1]) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    return await setPair(newPair)
                  }}
                />
                <span>⇆</span>
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={pair[1]}
                  onChange={async (value: TranslateLangCode) => {
                    const newPair: TranslateBidirectionalPair = [pair[0], value]
                    if (newPair[0] === newPair[1]) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    return await setPair(newPair)
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
