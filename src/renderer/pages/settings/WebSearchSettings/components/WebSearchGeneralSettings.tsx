import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { SettingGroup } from '@renderer/components/SettingsPrimitives'

import BasicSettings from './BasicSettings'
import BlacklistSettings from './BlacklistSettings'

interface Props {
  variant?: 'card' | 'plain'
}

export const WebSearchGeneralSettings: FC<Props> = ({ variant = 'card' }) => {
  const { t } = useTranslation()
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)

  return (
    <SettingGroup variant={variant}>
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
