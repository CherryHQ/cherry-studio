import { SettingOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { SettingDivider } from '@renderer/pages/settings'
import { SettingRow } from '@renderer/pages/settings'
import { Col, Row, Slider } from 'antd'
import { Popover } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const MessageGroupSettings: FC = () => {
  const [gridPopoverTrigger, setGridPopoverTrigger] = usePreference('chat.message.multi_model.grid_popover_trigger')
  const [gridColumns, setGridColumns] = usePreference('chat.message.multi_model.grid_columns')
  const { t } = useTranslation()

  const [gridColumnsValue, setGridColumnsValue] = useState(gridColumns)

  return (
    <Popover
      arrow={false}
      trigger={undefined}
      content={
        <div style={{ padding: 8 }}>
          <SettingRow>
            <div style={{ marginRight: 10 }}>{t('settings.messages.grid_popover_trigger.label')}</div>
            <Selector
              size={14}
              value={gridPopoverTrigger || 'hover'}
              onChange={(value) => setGridPopoverTrigger(value as 'hover' | 'click')}
              options={[
                { label: t('settings.messages.grid_popover_trigger.hover'), value: 'hover' },
                { label: t('settings.messages.grid_popover_trigger.click'), value: 'click' }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <div>{t('settings.messages.grid_columns')}</div>
          </SettingRow>
          <Row align="middle" gutter={10}>
            <Col span={24}>
              <Slider
                value={gridColumnsValue}
                style={{ width: '100%' }}
                onChange={(value) => setGridColumnsValue(value)}
                onChangeComplete={(value) => setGridColumns(value)}
                min={2}
                max={6}
                step={1}
              />
            </Col>
          </Row>
        </div>
      }>
      <SettingOutlined style={{ marginLeft: 15, cursor: 'pointer' }} />
    </Popover>
  )
}

export default MessageGroupSettings
