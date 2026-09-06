import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Alert, Button } from '@cherrystudio/ui'
import { SettingGroup } from '@renderer/components/SettingsPrimitives'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { useWebSearchPersist } from '@renderer/pages/settings/WebSearchSettings/hooks/useWebSearchPersist'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'

interface Props {
  variant?: 'card' | 'plain'
}

export const WebSearchGeneralSettings: FC<Props> = ({ variant = 'card' }) => {
  const { t } = useTranslation()
  const { compressionConfig, setCompressionConfig } = useWebSearchSettings()
  const persist = useWebSearchPersist()
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)

  const restoreDefaultCutoff = () => {
    void persist(
      () =>
        setCompressionConfig({
          method: 'cutoff',
          cutoffLimit: DEFAULT_WEB_SEARCH_CUTOFF_LIMIT
        }),
      'Failed to restore safe web search compression'
    )
  }

  return (
    <SettingGroup variant={variant}>
      {compressionConfig.method === 'none' && (
        <Alert
          className="mb-2"
          type="warning"
          showIcon
          message={t('settings.tool.websearch.compression.none_warning.message')}
          description={t('settings.tool.websearch.compression.none_warning.description')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={restoreDefaultCutoff}>
              {t('settings.tool.websearch.compression.none_warning.action')}
            </Button>
          }
        />
      )}
      <Accordion
        type="single"
        collapsible
        value={advancedSettingsOpen ? 'advanced' : ''}
        onValueChange={(value) => setAdvancedSettingsOpen(value === 'advanced')}>
        <AccordionItem value="advanced" className="border-0 first:border-t-0">
          <AccordionTrigger className="h-8 rounded-lg py-0 font-medium">
            {t('common.advanced_settings')}
          </AccordionTrigger>
          <AccordionContent forceMount hidden={!advancedSettingsOpen} className="pt-2 pb-0">
            <BasicSettings variant="plain" />
            <BlacklistSettings variant="plain" />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </SettingGroup>
  )
}
