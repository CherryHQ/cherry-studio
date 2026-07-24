import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ArrowUpDown, AudioLines, Boxes, Image, type LucideIcon, Mic, Speech, Type, Video } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import { modelSyncClasses } from '../primitives/ProviderSettingsPrimitives'
import type { ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'

type ModelTypeFilter = Exclude<ModelListCapabilityFilter, 'all'>

/** The model-type filters, in the order they render across the manage drawer and the model list. */
const MODEL_TYPE_FILTERS: ModelTypeFilter[] = [
  'text',
  'image',
  'embedding',
  'audio',
  'video',
  'rerank',
  'speech',
  'transcription'
]

const CAPABILITY_FILTER_LABEL_KEYS: Record<ModelTypeFilter, string> = {
  text: 'models.type.text',
  image: 'models.type.image',
  embedding: 'models.type.embedding',
  audio: 'models.type.audio',
  video: 'models.type.video',
  rerank: 'models.type.rerank',
  speech: 'models.type.speech',
  transcription: 'models.type.transcription'
}

// Icons align with the row tags (EmbeddingTag / RerankerTag …) so the same model
// type reads identically in the filter bar and on its row.
const CAPABILITY_FILTER_ICONS: Record<ModelTypeFilter, LucideIcon> = {
  text: Type,
  image: Image,
  embedding: Boxes,
  audio: AudioLines,
  video: Video,
  rerank: ArrowUpDown,
  speech: Speech,
  transcription: Mic
}

/** An extra tab rendered immediately after All (e.g. the manage drawer's "stale" tab). */
export interface ModelTypeFilterExtraTab {
  value: string
  label: string
  count: number
  destructive?: boolean
}

interface ModelTypeFilterTabsProps {
  value: string
  onValueChange: (value: string) => void
  counts: ModelListCapabilityCounts
  extraTabs?: ModelTypeFilterExtraTab[]
  className?: string
  listClassName?: string
}

/**
 * The shared model-type filter tab row: `All` + one tab per model type (icon +
 * label + count), plus optional tabs immediately after `All`. Selection is applied through a
 * transition so the active tab flips immediately while the (potentially large)
 * list re-filters in the background.
 */
export function ModelTypeFilterTabs({
  value,
  onValueChange,
  counts,
  extraTabs = [],
  className,
  listClassName
}: ModelTypeFilterTabsProps) {
  const { t } = useTranslation()
  const [optimisticValue, setOptimisticValue] = useState(value)
  const [, startFilterTransition] = useTransition()

  useEffect(() => {
    setOptimisticValue(value)
  }, [value])

  const handleValueChange = (next: string) => {
    setOptimisticValue(next)
    startFilterTransition(() => onValueChange(next))
  }

  return (
    <Tabs
      value={optimisticValue}
      onValueChange={handleValueChange}
      className={cn(modelSyncClasses.manageTabs, className)}>
      <TabsList className={cn(modelSyncClasses.manageTabsList, listClassName)}>
        <TabsTrigger value="all" className={modelSyncClasses.manageTabsTrigger}>
          <span className="truncate">{t('models.all')}</span>
          <span className={modelSyncClasses.manageTabCount} aria-hidden>
            {counts.all}
          </span>
        </TabsTrigger>
        {extraTabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className={cn(
              modelSyncClasses.manageTabsTrigger,
              tab.destructive && modelSyncClasses.manageTabsTriggerDestructive
            )}>
            <span className="truncate">{tab.label}</span>
            <span className={cn(modelSyncClasses.manageTabCount, tab.destructive && 'text-error-text')} aria-hidden>
              {tab.count}
            </span>
          </TabsTrigger>
        ))}
        {MODEL_TYPE_FILTERS.map((filter) => {
          const Icon = CAPABILITY_FILTER_ICONS[filter]
          return (
            <TabsTrigger key={filter} value={filter} className={modelSyncClasses.manageTabsTrigger}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t(CAPABILITY_FILTER_LABEL_KEYS[filter])}</span>
              <span className={modelSyncClasses.manageTabCount} aria-hidden>
                {counts[filter]}
              </span>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
