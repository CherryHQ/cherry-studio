import { Button, Row, Tooltip } from 'antd'
import { Plus } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '../..'

interface HeaderSectionProps {
  customItemsCount: number
  maxCustomItems: number
  onReset: () => void
  onAdd: () => void
}

const SettingsActionsListHeader = memo(({ customItemsCount, maxCustomItems, onReset, onAdd }: HeaderSectionProps) => {
  const { t } = useTranslation()
  const isCustomItemLimitReached = customItemsCount >= maxCustomItems

  return (
    <Row>
      <SettingTitle>{t('selection.settings.actions.title')}</SettingTitle>
      <Spacer />
      <Tooltip title={t('selection.settings.actions.reset.tooltip')}>
        <ResetButton type="text" onClick={onReset}>
          {t('selection.settings.actions.reset.button')}
        </ResetButton>
      </Tooltip>
      <Tooltip
        title={
          isCustomItemLimitReached
            ? t('selection.settings.actions.add_tooltip.disabled', { max: maxCustomItems })
            : t('selection.settings.actions.add_tooltip.enabled')
        }>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={onAdd}
          disabled={isCustomItemLimitReached}
          style={{ paddingInline: '8px' }}>
          {t('selection.settings.actions.custom')}
        </Button>
      </Tooltip>
    </Row>
  )
})

const Spacer = styled.div`
  flex: 1;
`

const ResetButton = styled(Button)`
  margin: 0 8px;
  color: var(--color-text-3);
  &:hover {
    color: var(--color-primary);
  }
`

export default SettingsActionsListHeader
