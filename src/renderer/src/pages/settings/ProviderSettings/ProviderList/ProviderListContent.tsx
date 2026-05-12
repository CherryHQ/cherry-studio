import { ReorderableList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type ProviderListContentItemState = {
  dragging: boolean
}

interface ProviderListContentProps {
  providers: Provider[]
  enabledProviders: Provider[]
  disabledProviders: Provider[]
  scrollerRef?: (element: HTMLDivElement | null) => void
  onDragStateChange: (nextDragging: boolean) => void
  onReorder: (reorderedProviders: Provider[]) => void | Promise<void>
  onReorderError?: (error: unknown) => void
  renderItem: (provider: Provider, index: number, state: ProviderListContentItemState) => ReactNode
}

export default function ProviderListContent({
  providers,
  enabledProviders,
  disabledProviders,
  scrollerRef,
  onDragStateChange,
  onReorder,
  onReorderError,
  renderItem
}: ProviderListContentProps) {
  const { t } = useTranslation()
  const hasResults = enabledProviders.length > 0 || disabledProviders.length > 0

  const renderSection = (sectionProviders: Provider[]) => (
    <ReorderableList
      items={providers}
      visibleItems={sectionProviders}
      getId={(provider) => provider.id}
      onDragStateChange={onDragStateChange}
      onReorder={onReorder}
      onReorderError={onReorderError}
      className="w-full"
      gap="var(--provider-list-row-gap)"
      restrictions={{ scrollableAncestor: true }}
      renderItem={renderItem}
    />
  )

  return (
    <Scrollbar ref={scrollerRef} className={providerListClasses.scroller}>
      {hasResults ? (
        <div className={providerListClasses.sectionStack}>
          {enabledProviders.length > 0 && (
            <section className={providerListClasses.section}>
              <div className={providerListClasses.sectionHeader}>
                <p className={providerListClasses.sectionLabel}>
                  {t('settings.models.check.enabled')} ({enabledProviders.length})
                </p>
              </div>
              {renderSection(enabledProviders)}
            </section>
          )}
          {disabledProviders.length > 0 && (
            <section className={providerListClasses.section}>
              <div
                className={cn(
                  providerListClasses.sectionHeader,
                  enabledProviders.length > 0 && providerListClasses.sectionHeaderAfterEnabled
                )}>
                <p className={providerListClasses.sectionLabel}>
                  {t('settings.models.check.disabled')} ({disabledProviders.length})
                </p>
              </div>
              {renderSection(disabledProviders)}
            </section>
          )}
        </div>
      ) : (
        <div className={providerListClasses.emptyState}>{t('common.no_results')}</div>
      )}
    </Scrollbar>
  )
}
