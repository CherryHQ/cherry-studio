import { Button, Tabs, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { paintingClasses } from '../PaintingPrimitives'

export type PaintingModeTabDef = { labelKey: string; value: string }

export function PaintingPromptLeadingActions({
  onToggleParameters,
  modeTabs
}: {
  onToggleParameters: () => void
  modeTabs?: {
    tabs: PaintingModeTabDef[]
    value: string
    onValueChange: (value: string) => void
  }
}) {
  const { t } = useTranslation()

  return (
    <>
      <Tooltip content={t('common.settings')} delay={500}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={paintingClasses.promptSettingButton}
          aria-label={t('common.settings')}
          onClick={onToggleParameters}>
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </Tooltip>
      {modeTabs ? (
        <Tabs value={modeTabs.value} onValueChange={modeTabs.onValueChange}>
          <TabsList className={paintingClasses.promptModeTabsList}>
            {modeTabs.tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className={cn(paintingClasses.promptModeTabsTrigger)}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
    </>
  )
}
