import { Button, ColFlex, Flex, HelpTooltip, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import LanguageSelect from '@renderer/components/LanguageSelect'
import type { Model } from '@renderer/types'
import { Modal, Radio, Space } from 'antd'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateSettingsPopup from '../settings/TranslateSettingsPopup/TranslateSettingsPopup'

const TranslateSettings: FC<{
  visible: boolean
  onClose: () => void
  translateModel: Model | undefined
}> = ({ visible, onClose }) => {
  const { t } = useTranslation()
  const [autoCopy, setAutoCopy] = usePreference('translate.settings.auto_copy')
  const [autoDetectionMethod, setAutoDetectionMethod] = usePreference('translate.settings.auto_detection_method')
  const [enableMarkdown, setEnableMarkdown] = usePreference('translate.settings.enable_markdown')
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = usePreference('translate.settings.scroll_sync')
  const [bidirectional, setBidirectional] = useCache('translate.bidirectional')
  const { enabled: isBidirectional } = bidirectional
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
                setAutoCopy(isSelected)
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
          <RowFlex className="items-center gap-[5px]">
            <Radio.Group
              defaultValue={'auto'}
              value={autoDetectionMethod}
              optionType="button"
              buttonStyle="solid"
              onChange={(e) => {
                setAutoDetectionMethod(e.target.value)
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
              <RowFlex className="items-center gap-[5px]">
                {t('translate.settings.bidirectional')}
                <HelpTooltip
                  content={t('translate.settings.bidirectional_tip')}
                  iconProps={{ className: 'text-text-3' }}
                />
              </RowFlex>
            </div>
            <Switch
              isSelected={isBidirectional}
              color="primary"
              onValueChange={(isSelected) => {
                setBidirectional({ ...bidirectional, enabled: isSelected })
                // 双向翻译设置不需要持久化，它只是界面状态
              }}
            />
          </Flex>
          {isBidirectional && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Flex className="items-center justify-between gap-2.5">
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={bidirectional.origin}
                  onChange={(value) => {
                    if (value === bidirectional.target) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    setBidirectional({
                      ...bidirectional,
                      origin: value,
                      target: bidirectional.target
                    })
                  }}
                />
                <span>⇆</span>
                <LanguageSelect
                  style={{ flex: 1 }}
                  value={bidirectional.target}
                  onChange={(value) => {
                    if (bidirectional.origin === value) {
                      window.toast.warning(t('translate.language.same'))
                      return
                    }
                    setBidirectional({
                      ...bidirectional,
                      origin: bidirectional.origin,
                      target: value
                    })
                  }}
                />
              </Flex>
            </Space>
          )}
        </div>
        <Button onPress={onMoreSetting}>{t('settings.moresetting.label')}</Button>
      </ColFlex>
    </Modal>
  )
}

export default memo(TranslateSettings)
