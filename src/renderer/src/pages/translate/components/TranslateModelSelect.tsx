import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { isFunctionCallingModel, isReasoningModel, isVisionModel } from '@renderer/config/models'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Model, ModelTag, Provider } from '@renderer/types'
import { filterModelsByKeywords } from '@renderer/utils'
import { cn } from '@renderer/utils'
import { getDuplicateModelNames } from '@renderer/utils/model'
import { isFreeModel } from '@renderer/utils/model'
import { Brain, Eye, Hammer, Search, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ChipTag = Extract<ModelTag, 'vision' | 'reasoning' | 'function_calling' | 'free'>

type ModelRow = Model & { _provider: Provider }

type Props = {
  model?: Model
  onSelectModel: (model: Model) => void
  modelFilter?: (model: Model) => boolean
}

const TAG_PREDICATES: Record<ChipTag, (model: Model) => boolean> = {
  vision: isVisionModel,
  reasoning: isReasoningModel,
  function_calling: isFunctionCallingModel,
  free: isFreeModel
}

const CHIP_TAGS: readonly ChipTag[] = ['vision', 'reasoning', 'function_calling', 'free'] as const

const TAG_I18N_KEYS: Record<ChipTag, string> = {
  vision: 'models.type.vision',
  reasoning: 'models.type.reasoning',
  function_calling: 'models.type.function_calling',
  free: 'models.type.free'
}

const TagChipIcon: FC<{ tag: ChipTag }> = ({ tag }) => {
  switch (tag) {
    case 'vision':
      return <Eye size={9} />
    case 'reasoning':
      return <Brain size={9} />
    case 'function_calling':
      return <Hammer size={9} />
    case 'free':
      return <span className="text-[9px] leading-none">🆓</span>
  }
}

const ModelRowTags: FC<{ model: Model }> = ({ model }) => {
  const tags = useMemo(() => CHIP_TAGS.filter((tag) => TAG_PREDICATES[tag](model)), [model])
  const { t } = useTranslation()
  if (tags.length === 0) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            'rounded px-1 py-[1px] text-[8px]',
            tag === 'free' ? 'bg-muted text-muted-foreground' : 'bg-accent text-foreground-secondary'
          )}>
          {t(TAG_I18N_KEYS[tag])}
        </span>
      ))}
    </div>
  )
}

const TranslateModelSelect: FC<Props> = ({ model, onSelectModel, modelFilter }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<ChipTag | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredModels = useMemo<ModelRow[]>(() => {
    const rows: ModelRow[] = []
    for (const provider of providers) {
      let models = provider.models
      if (modelFilter) models = models.filter(modelFilter)
      if (search.trim()) models = filterModelsByKeywords(search.trim(), models, provider)
      if (activeTag) models = models.filter(TAG_PREDICATES[activeTag])
      for (const m of models) rows.push({ ...m, _provider: provider })
    }
    return rows
  }, [providers, modelFilter, search, activeTag])

  const duplicateNames = useMemo(() => getDuplicateModelNames(filteredModels), [filteredModels])

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDropdown()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeDropdown, open])

  const handleSelect = useCallback(
    (m: Model) => {
      onSelectModel(m)
      closeDropdown()
    },
    [closeDropdown, onSelectModel]
  )

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={model?.name}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-3xs transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          open ? 'bg-accent text-foreground' : 'text-foreground-secondary hover:bg-accent hover:text-foreground'
        )}>
        {model ? <ModelAvatar model={model} size={18} /> : <Sparkles size={13} />}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-[340px] overflow-hidden rounded-xs border border-border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-border/30 border-b px-3 py-2.5">
            <Search size={13} className="shrink-0 text-foreground-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('models.search.placeholder')}
              className="flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-foreground-muted"
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-border/20 border-b px-3 py-2">
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                !activeTag
                  ? 'border-foreground/20 bg-accent text-foreground'
                  : 'border-border/50 text-muted-foreground hover:bg-accent'
              )}>
              {t('models.all')}
            </button>
            {CHIP_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  activeTag === tag
                    ? 'border-foreground/20 bg-accent text-foreground'
                    : 'border-border/50 text-muted-foreground hover:bg-accent'
                )}>
                <TagChipIcon tag={tag} />
                {t(TAG_I18N_KEYS[tag])}
              </button>
            ))}
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-foreground-muted text-xs">{t('models.no_matches')}</div>
            ) : (
              filteredModels.map((row) => {
                const isActive = model?.id === row.id && model?.provider === row.provider
                const isDuplicate = duplicateNames.has(row.name)
                return (
                  <button
                    key={`${row.provider}-${row.id}`}
                    type="button"
                    onClick={() => handleSelect(row)}
                    className="w-full px-1.5 py-[2px] text-left text-xs focus-visible:outline-none">
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-2xs px-2 py-1.5 transition-colors',
                        isActive ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'
                      )}>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <ModelAvatar model={row} size={18} />
                      </span>
                      <span className="flex-1 truncate">
                        {row.name}
                        {isDuplicate && <span className="ml-1 text-foreground-muted">| {row._provider.name}</span>}
                      </span>
                      <ModelRowTags model={row} />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TranslateModelSelect
