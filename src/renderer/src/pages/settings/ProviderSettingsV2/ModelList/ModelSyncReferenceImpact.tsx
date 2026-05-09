import { parseUniqueModelId } from '@shared/data/types/model'
import { useTranslation } from 'react-i18next'

import { modelSyncClasses } from '../components/ProviderSettingsPrimitives'
import type { ModelSyncReferenceSummary } from './modelSyncPreviewTypes'

interface ModelSyncReferenceImpactProps {
  summary: ModelSyncReferenceSummary
}

export default function ModelSyncReferenceImpact({ summary }: ModelSyncReferenceImpactProps) {
  const { t } = useTranslation()

  return (
    <section className={modelSyncClasses.impactCard}>
      <div className={modelSyncClasses.sectionTitle}>{t('settings.models.manage.sync_impact_section')}</div>
      <div className={modelSyncClasses.sectionMeta}>
        {t('settings.models.manage.sync_impact_summary', {
          models: summary.impactedModelCount,
          references: summary.totalStrongReferences
        })}
      </div>
      {summary.items.length > 0 ? (
        <div className={modelSyncClasses.impactList}>
          {summary.items.map((item) => (
            <div key={item.uniqueModelId} className={modelSyncClasses.impactItem}>
              <div className="font-medium text-foreground/85">{parseUniqueModelId(item.uniqueModelId).modelId}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground/80">
                {item.assistantCount > 0 ? (
                  <span>{t('settings.models.manage.sync_reference_assistants', { count: item.assistantCount })}</span>
                ) : null}
                {item.knowledgeCount > 0 ? (
                  <span>{t('settings.models.manage.sync_reference_knowledge', { count: item.knowledgeCount })}</span>
                ) : null}
                {item.preferenceReferences.length > 0 ? (
                  <span>
                    {t('settings.models.manage.sync_reference_preferences', {
                      count: item.preferenceReferences.length
                    })}
                  </span>
                ) : null}
              </div>
              {item.preferenceReferences.length > 0 ? (
                <div className="mt-2 text-muted-foreground/75">{item.preferenceReferences.join(', ')}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-[length:var(--font-size-caption)] text-muted-foreground/75 leading-[var(--line-height-caption)]">
          {t('settings.models.manage.sync_no_references')}
        </div>
      )}
    </section>
  )
}
