import { ReorderableList } from '@cherrystudio/ui'
import type { Provider } from '@shared/data/types/provider'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type ProviderListContentItemState = {
  dragging: boolean
  [key: string]: unknown
}

interface ProviderListContentProps {
  providers: Provider[]
  filteredProviders: Provider[]
  onDragStateChange: (nextDragging: boolean) => void
  onReorder: (reorderedProviders: Provider[]) => void | Promise<void>
  renderItem: (provider: Provider, index: number, state: ProviderListContentItemState) => ReactNode
}

export default function ProviderListContent({
  providers,
  filteredProviders,
  onDragStateChange,
  onReorder,
  renderItem
}: ProviderListContentProps) {
  const { t } = useTranslation()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[2px]">
      {filteredProviders.length > 0 ? (
        <ReorderableList
          items={providers}
          visibleItems={filteredProviders}
          getId={(provider) => provider.id}
          onDragStateChange={onDragStateChange}
          onReorder={onReorder}
          className="w-full"
          gap={1}
          restrictions={{ scrollableAncestor: true }}
          renderItem={renderItem}
        />
      ) : (
        <div className="flex h-full min-h-40 items-center justify-center px-3 text-center text-(--color-muted-foreground) text-[14px]">
          {t('common.no_results')}
        </div>
      )}
    </div>
  )
}
