import { Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type {
  CacheCleanupGroup,
  CacheCleanupGroupInspection,
  CacheCleanupSizeSnapshot
} from '@shared/types/cacheCleanup'
import { CACHE_CLEANUP_GROUPS } from '@shared/types/cacheCleanup'
import { ArchiveRestore, DatabaseZap, Globe2, LoaderCircle, type LucideIcon, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { inspectLegacyV1BrowserData } from './legacyV1BrowserData'

interface ClearCachePopupParams {
  onClear: (groups: CacheCleanupGroup[]) => Promise<void>
}

interface CleanupOptionState {
  loading: boolean
  inspection?: CacheCleanupGroupInspection
}

const CLEANUP_OPTIONS = [
  {
    group: 'normal_cache',
    icon: Trash2,
    titleKey: 'settings.data.clear_cache.options.normal_cache.title',
    descriptionKey: 'settings.data.clear_cache.options.normal_cache.description'
  },
  {
    group: 'site_data',
    icon: Globe2,
    titleKey: 'settings.data.clear_cache.options.site_data.title',
    descriptionKey: 'settings.data.clear_cache.options.site_data.description'
  },
  {
    group: 'legacy_v1',
    icon: DatabaseZap,
    titleKey: 'settings.data.clear_cache.options.legacy_v1.title',
    descriptionKey: 'settings.data.clear_cache.options.legacy_v1.description'
  },
  {
    group: 'restore_staging',
    icon: ArchiveRestore,
    titleKey: 'settings.data.clear_cache.options.restore_staging.title',
    descriptionKey: 'settings.data.clear_cache.options.restore_staging.description'
  }
] as const satisfies ReadonlyArray<{
  group: CacheCleanupGroup
  icon: LucideIcon
  titleKey: string
  descriptionKey: string
}>

type Props = ClearCachePopupParams & PopupInjectedProps<void>

export function formatCacheCleanupSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB'] as const
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 }).format(value)
  return `${formatted} ${units[unitIndex]}`
}

function mergeLegacySizes(
  mainInspection: CacheCleanupGroupInspection,
  browserSize: CacheCleanupSizeSnapshot
): CacheCleanupGroupInspection {
  const knownBytes = [mainInspection.size.bytes, browserSize.bytes].filter((bytes): bytes is number => bytes !== null)
  const bytes = knownBytes.length === 0 ? null : knownBytes.reduce((total, value) => total + value, 0)
  const completeness =
    mainInspection.size.completeness === 'partial' || browserSize.completeness === 'partial' ? 'partial' : 'complete'

  return {
    ...mainInspection,
    size: {
      bytes,
      accuracy: bytes === null ? 'unavailable' : 'estimated',
      completeness,
      issues: [...mainInspection.size.issues, ...browserSize.issues]
    }
  }
}

function createLoadingOptionStates(): Record<CacheCleanupGroup, CleanupOptionState> {
  return Object.fromEntries(CACHE_CLEANUP_GROUPS.map((group) => [group, { loading: true }])) as Record<
    CacheCleanupGroup,
    CleanupOptionState
  >
}

async function inspectCleanupGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupInspection> {
  try {
    const response = await ipcApi.request('app.cache_cleanup.inspect', { groups: [group] })
    let inspection = response.results[0]
    if (!inspection) throw new Error(`Missing cache cleanup inspection for ${group}`)

    if (group === 'legacy_v1' && inspection.allowed) {
      inspection = mergeLegacySizes(inspection, await inspectLegacyV1BrowserData())
    }
    return inspection
  } catch {
    return {
      group,
      allowed: true,
      size: {
        bytes: null,
        accuracy: 'unavailable',
        completeness: 'partial',
        issues: [{ item: group, code: 'inspection_failed' }]
      }
    }
  }
}

export const ClearCachePopupContainer: React.FC<Props> = ({ open, resolve, onClear }) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<CacheCleanupGroup>>(() => new Set(['normal_cache']))
  const [optionStates, setOptionStates] =
    useState<Record<CacheCleanupGroup, CleanupOptionState>>(createLoadingOptionStates)
  const [cleaning, setCleaning] = useState(false)
  const [hasRunCleanup, setHasRunCleanup] = useState(false)
  const inspectionGeneration = useRef(0)

  const refreshInspections = useCallback(async () => {
    const generation = ++inspectionGeneration.current
    setOptionStates(createLoadingOptionStates())

    await Promise.all(
      CACHE_CLEANUP_GROUPS.map(async (group) => {
        const inspection = await inspectCleanupGroup(group)
        if (generation !== inspectionGeneration.current) return
        setOptionStates((current) => ({ ...current, [group]: { loading: false, inspection } }))
        if (!inspection.allowed) {
          setSelected((current) => {
            if (!current.has(group)) return current
            const next = new Set(current)
            next.delete(group)
            return next
          })
        }
      })
    )
  }, [])

  useEffect(() => {
    if (open) {
      void refreshInspections()
    } else {
      inspectionGeneration.current++
    }
  }, [open, refreshInspections])

  const selectedStates = useMemo(() => [...selected].map((group) => optionStates[group]), [optionStates, selected])
  const totalLoading = selectedStates.some((state) => state.loading)
  const totalBytes = selectedStates.reduce((total, state) => total + (state.inspection?.size.bytes ?? 0), 0)
  const totalHasUnknown = selectedStates.some(
    (state) =>
      !state.loading && (state.inspection?.size.bytes === null || state.inspection?.size.completeness === 'partial')
  )
  const totalEstimated = selectedStates.some((state) => state.inspection?.size.accuracy === 'estimated')
  const canConfirm =
    !cleaning &&
    selected.size > 0 &&
    !totalLoading &&
    selectedStates.every((state) => state.inspection?.allowed !== false)

  const toggleGroup = (group: CacheCleanupGroup, checked: boolean) => {
    if (cleaning) return
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(group)
      else next.delete(group)
      return next
    })
  }

  const renderSize = (state: CleanupOptionState) => {
    if (state.loading) {
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('settings.data.clear_cache.calculating')}
        </span>
      )
    }

    const size = state.inspection?.size
    if (!size || size.bytes === null) {
      return <span className="text-muted-foreground">{t('settings.data.clear_cache.unavailable')}</span>
    }

    const formatted = formatCacheCleanupSize(size.bytes)
    if (size.completeness === 'partial') {
      return (
        <span className="text-muted-foreground">
          {t('settings.data.clear_cache.total_partial', { size: formatted })}
        </span>
      )
    }
    return (
      <span className="text-muted-foreground">
        {size.accuracy === 'estimated' ? t('settings.data.clear_cache.approximately', { size: formatted }) : formatted}
      </span>
    )
  }

  const renderTotal = () => {
    if (totalLoading) return t('settings.data.clear_cache.calculating')

    const formatted = formatCacheCleanupSize(totalBytes)
    if (totalHasUnknown) {
      return t('settings.data.clear_cache.total_partial', { size: formatted })
    }
    if (totalEstimated) {
      return t('settings.data.clear_cache.approximately', { size: formatted })
    }
    return formatted
  }

  const handleConfirm = async () => {
    if (!canConfirm) return

    const groups = CACHE_CLEANUP_GROUPS.filter((group) => selected.has(group))
    setCleaning(true)
    try {
      await onClear(groups)
    } finally {
      setHasRunCleanup(true)
      await refreshInspections()
      setCleaning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !cleaning && resolve(undefined)}>
      <DialogContent
        className="gap-5 sm:max-w-2xl"
        closeOnOverlayClick={!cleaning}
        showCloseButton={!cleaning}
        onEscapeKeyDown={(event) => {
          if (cleaning) event.preventDefault()
        }}>
        <DialogHeader>
          <DialogTitle>{t('settings.data.clear_cache.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {CLEANUP_OPTIONS.map(({ group, icon: Icon, titleKey, descriptionKey }) => {
            const state = optionStates[group]
            const blocked = state.inspection?.allowed === false
            const disabled = cleaning || blocked

            return (
              <label
                key={group}
                className={`flex gap-3 rounded-lg border p-3 ${
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40'
                }`}>
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(group)}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggleGroup(group, checked === true)}
                />
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-medium text-sm">{t(titleKey)}</span>
                    <span className="shrink-0 text-xs">{renderSize(state)}</span>
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs leading-5">{t(descriptionKey)}</span>
                  {blocked ? (
                    <span className="mt-1 block text-warning text-xs">
                      {t('settings.data.clear_cache.migration_incomplete')}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t pt-4 text-sm">
          <span className="font-medium">{t('settings.data.clear_cache.selected_total')}</span>
          <span className="text-muted-foreground">{selected.size === 0 ? '0 B' : renderTotal()}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={cleaning} onClick={() => resolve(undefined)}>
            {t(hasRunCleanup ? 'common.close' : 'common.cancel')}
          </Button>
          <Button variant="destructive" disabled={!canConfirm} loading={cleaning} onClick={handleConfirm}>
            {t('settings.data.clear_cache.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ClearCachePopup = createPopup<ClearCachePopupParams, void>(ClearCachePopupContainer)

export default ClearCachePopup
