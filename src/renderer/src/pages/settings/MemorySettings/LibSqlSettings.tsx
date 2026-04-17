/**
 * LibSqlSettings — configuration panel for the built-in LibSQL memory provider.
 * Displayed only when provider = 'libsql'.
 */

import { Input, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTranslation } from 'react-i18next'

import { SettingDescription, SettingGroup, SettingRow, SettingRowTitle, SettingSubtitle } from '../index'

export function LibSqlSettings() {
  const { t } = useTranslation()
  const [embedderModel, setEmbedderModel] = usePreference('feature.memory.libsql.embedder_model')
  const [dimensions, setDimensions] = usePreference('feature.memory.libsql.embedder_dimensions')
  const [autoDimensions, setAutoDimensions] = usePreference('feature.memory.libsql.auto_dimensions')
  const [threshold, setThreshold] = usePreference('feature.memory.libsql.similarity_threshold')

  return (
    <SettingGroup>
      <SettingSubtitle>{t('settings.memory.libsql.title', 'Built-in Provider (LibSQL)')}</SettingSubtitle>
      <SettingDescription>
        {t(
          'settings.memory.libsql.description',
          'Local memory stored on this device using vector search. Requires an embedding model to be configured.'
        )}
      </SettingDescription>

      <div className="mt-4 space-y-3">
        <SettingRow>
          <SettingRowTitle>{t('settings.memory.libsql.embedder_model', 'Embedding Model ID')}</SettingRowTitle>
          <Input
            className="w-72"
            placeholder={t('settings.memory.libsql.embedder_model_placeholder', 'e.g. text-embedding-3-small')}
            value={embedderModel}
            onChange={(e) => setEmbedderModel(e.target.value)}
          />
        </SettingRow>

        <SettingRow>
          <SettingRowTitle>{t('settings.memory.libsql.auto_dimensions', 'Auto-detect Dimensions')}</SettingRowTitle>
          <Switch checked={autoDimensions} onCheckedChange={(v) => setAutoDimensions(v)} />
        </SettingRow>

        {!autoDimensions && (
          <SettingRow>
            <SettingRowTitle>{t('settings.memory.libsql.embedder_dimensions', 'Embedding Dimensions')}</SettingRowTitle>
            <Input
              className="w-24"
              type="number"
              min={64}
              max={4096}
              value={dimensions}
              onChange={(e) => setDimensions(Number(e.target.value))}
            />
          </SettingRow>
        )}

        <SettingRow>
          <SettingRowTitle>{t('settings.memory.libsql.similarity_threshold', 'Similarity Threshold')}</SettingRowTitle>
          <Input
            className="w-24"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </SettingRow>
      </div>
    </SettingGroup>
  )
}
