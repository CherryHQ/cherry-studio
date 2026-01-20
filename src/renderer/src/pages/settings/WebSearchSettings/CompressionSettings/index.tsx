import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '@renderer/pages/settings'
import type { WebSearchCompressionMethod } from '@shared/data/preference/preferenceTypes'
import { useTranslation } from 'react-i18next'

import CutoffSettings from './CutoffSettings'
import RagSettings from './RagSettings'

const CompressionSettings = () => {
  const { t } = useTranslation()
  const { compressionMethod, setCompressionMethod } = useWebSearchSettings()

  const handleCompressionMethodChange = (method: WebSearchCompressionMethod) => {
    setCompressionMethod(method)
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.tool.websearch.compression.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.tool.websearch.compression.method.label')}</SettingRowTitle>
        <Select value={compressionMethod} onValueChange={handleCompressionMethodChange}>
          <SelectTrigger className={compressionMethod === 'rag' ? 'w-[min(350px,60%)]' : 'w-[200px]'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('settings.tool.websearch.compression.method.none')}</SelectItem>
            <SelectItem value="cutoff">{t('settings.tool.websearch.compression.method.cutoff')}</SelectItem>
            <SelectItem value="rag">{t('settings.tool.websearch.compression.method.rag')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingDivider />

      {compressionMethod === 'cutoff' && <CutoffSettings />}
      {compressionMethod === 'rag' && <RagSettings />}
    </SettingGroup>
  )
}

export default CompressionSettings
