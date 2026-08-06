import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { createPopup, popup, type PopupInjectedProps } from '@renderer/services/popup'
import type {
  CacheCleanupGroup,
  CacheCleanupGroupInspection,
  CacheCleanupSizeSnapshot
} from '@shared/types/cacheCleanup'
import { CACHE_CLEANUP_GROUPS } from '@shared/types/cacheCleanup'
import { DatabaseZap, FolderX, Globe2, LoaderCircle, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { hasLegacyV1Marker, inspectLegacyV1BrowserData } from './legacyV1BrowserData'

interface ClearCachePopupParams {
  onClear: (groups: CacheCleanupGroup[]) => Promise<boolean>
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
    group: 'orphaned_data',
    icon: FolderX,
    titleKey: 'settings.data.clear_cache.options.orphaned_data.title',
    descriptionKey: 'settings.data.clear_cache.options.orphaned_data.description'
  },
  {
    group: 'legacy_v1',
    icon: DatabaseZap,
    titleKey: 'settings.data.clear_cache.options.legacy_v1.title',
    descriptionKey: 'settings.data.clear_cache.options.legacy_v1.description'
  }
] as const

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
      completeness
    }
  }
}

function createLoadingOptionStates(): Record<CacheCleanupGroup, CleanupOptionState> {
  return Object.fromEntries(CACHE_CLEANUP_GROUPS.map((group) => [group, { loading: true }])) as Record<
    CacheCleanupGroup,
    CleanupOptionState
  >
}

function getVisibleCleanupGroups(): CacheCleanupGroup[] {
  return CACHE_CLEANUP_GROUPS.filter((group) => group !== 'legacy_v1' || hasLegacyV1Marker())
}

async function inspectCleanupGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupInspection> {
  try {
    const response = await ipcApi.request('app.cache_cleanup.inspect', { groups: [group] })
    let inspection = response.results[0]
    if (!inspection) throw new Error(`Missing cache cleanup inspection for ${group}`)

    if (group === 'legacy_v1') {
      inspection = mergeLegacySizes(inspection, await inspectLegacyV1BrowserData())
    }
    return inspection
  } catch {
    return {
      group,
      size: {
        bytes: null,
        accuracy: 'unavailable',
        completeness: 'partial'
      }
    }
  }
}

export const ClearCachePopupContainer: React.FC<Props> = ({ open, resolve, onClear }) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<CacheCleanupGroup>>(() => new Set())
  const [optionStates, setOptionStates] =
    useState<Record<CacheCleanupGroup, CleanupOptionState>>(createLoadingOptionStates)
  const [visibleGroups, setVisibleGroups] = useState<CacheCleanupGroup[]>(getVisibleCleanupGroups)
  const [cleaning, setCleaning] = useState(false)
  const [hasRunCleanup, setHasRunCleanup] = useState(false)
  const inspectionGeneration = useRef(0)
  const popupOpen = useRef(open)

  const refreshInspections = useCallback(async () => {
    const generation = ++inspectionGeneration.current
    const groups = getVisibleCleanupGroups()
    setVisibleGroups(groups)
    setSelected((current) => new Set(groups.filter((group) => current.has(group))))
    setOptionStates(createLoadingOptionStates())

    await Promise.all(
      groups.map(async (group) => {
        const inspection = await inspectCleanupGroup(group)
        if (generation !== inspectionGeneration.current) return
        setOptionStates((current) => ({ ...current, [group]: { loading: false, inspection } }))
      })
    )
  }, [])

  useEffect(() => {
    popupOpen.current = open
    if (open) {
      void refreshInspections()
    } else {
      inspectionGeneration.current++
    }
  }, [open, refreshInspections])

  const selectedGroups = visibleGroups.filter((group) => selected.has(group))
  const selectedStates = selectedGroups.map((group) => optionStates[group])
  const totalLoading = selectedStates.some((state) => state.loading)
  const totalBytes = selectedStates.reduce((total, state) => total + (state.inspection?.size.bytes ?? 0), 0)
  const totalHasUnknown = selectedStates.some(
    (state) =>
      !state.loading && (state.inspection?.size.bytes === null || state.inspection?.size.completeness === 'partial')
  )
  const totalEstimated = selectedStates.some((state) => state.inspection?.size.accuracy === 'estimated')
  const canConfirm = !cleaning && selectedGroups.length > 0 && !totalLoading

  const toggleGroup = async (group: CacheCleanupGroup, checked: boolean) => {
    if (cleaning) return

    if (group === 'legacy_v1' && checked) {
      const confirmed = await popup.confirm({
        title: t('settings.data.clear_cache.legacy_warning.title'),
        content: (
          <Alert
            type="error"
            showIcon
            className="shadow-none"
            message={t('settings.data.clear_cache.legacy_warning.message')}
            description={t('settings.data.clear_cache.legacy_warning.description')}
          />
        ),
        icon: null,
        okText: t('settings.data.clear_cache.legacy_warning.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        maskClosable: false,
        closable: false
      })
      if (!confirmed || !popupOpen.current) return
    }

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
        <>
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('settings.data.clear_cache.calculating')}
        </>
      )
    }

    const size = state.inspection?.size
    if (!size || size.bytes === null) return t('settings.data.clear_cache.unavailable')

    const formatted = formatCacheCleanupSize(size.bytes)
    if (size.completeness === 'partial') return t('settings.data.clear_cache.total_partial', { size: formatted })
    return size.accuracy === 'estimated' ? t('settings.data.clear_cache.approximately', { size: formatted }) : formatted
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

    setCleaning(true)
    const success = await onClear(selectedGroups)
    if (!popupOpen.current) return
    if (success) {
      handleClose()
      return
    }
    setHasRunCleanup(true)
    setCleaning(false)
    void refreshInspections()
  }

  const handleClose = () => {
    popupOpen.current = false
    resolve(undefined)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent size="lg" className="gap-5">
        <DialogHeader>
          <DialogTitle>{t('settings.data.clear_cache.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {CLEANUP_OPTIONS.filter(({ group }) => visibleGroups.includes(group)).map(
            ({ group, icon: Icon, titleKey, descriptionKey }) => {
              const state = optionStates[group]

              return (
                <label
                  key={group}
                  className={`flex gap-3 rounded-lg border p-3 ${
                    cleaning ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40'
                  }`}>
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(group)}
                    disabled={cleaning}
                    onCheckedChange={(checked) => void toggleGroup(group, checked === true)}
                  />
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-medium text-sm">{t(titleKey)}</span>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                        {renderSize(state)}
                      </span>
                    </span>
                    <span className="mt-1 block text-muted-foreground text-xs leading-5">{t(descriptionKey)}</span>
                  </span>
                </label>
              )
            }
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4 text-sm">
          <span className="font-medium">{t('settings.data.clear_cache.selected_total')}</span>
          <span className="text-muted-foreground">{selectedGroups.length === 0 ? '0 B' : renderTotal()}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t(cleaning || hasRunCleanup ? 'common.close' : 'common.cancel')}
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
