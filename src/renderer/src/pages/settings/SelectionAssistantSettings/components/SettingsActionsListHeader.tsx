import { Button, Tooltip } from '@cherrystudio/ui'
import { Row } from 'antd'
import { Plus } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

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
    <Row className="w-full">
      <SettingTitle>{t('selection.settings.actions.title')}</SettingTitle>
      <div className="flex-1" />
      <Tooltip content={t('selection.settings.actions.reset.tooltip')}>
        <Button variant="ghost" className="mx-2 text-foreground-muted hover:text-primary" onClick={onReset}>
          {t('selection.settings.actions.reset.button')}
        </Button>
      </Tooltip>
      <Tooltip
        content={
          isCustomItemLimitReached
            ? t('selection.settings.actions.add_tooltip.disabled', { max: maxCustomItems })
            : t('selection.settings.actions.add_tooltip.enabled')
        }>
        <Button onClick={onAdd} disabled={isCustomItemLimitReached} style={{ paddingInline: '8px' }}>
          <Plus size={16} />
          {t('selection.settings.actions.custom')}
        </Button>
      </Tooltip>
    </Row>
  )
})

export default SettingsActionsListHeader
