import { RefreshIcon } from '@renderer/components/Icons'
import { SkeletonSpan } from '@renderer/components/Skeleton/InlineSkeleton'
import DynamicVirtualList from '@renderer/components/VirtualList/dynamic'
import { type MarketplaceEntry, useMarketplaceBrowser } from '@renderer/hooks/useMarketplaceBrowser'
import { useTimer } from '@renderer/hooks/useTimer'
import type { MarketplaceSort } from '@renderer/services/MarketplaceService'
import type { InstalledPlugin, PluginMetadata } from '@renderer/types/plugin'
import { Button as AntButton, Dropdown as AntDropdown, Input as AntInput, Tabs as AntTabs, Tooltip } from 'antd'
import { AlertCircle, Search } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PluginCard } from './PluginCard'
import { PluginDetailModal } from './PluginDetailModal'

export type PluginFilterType = 'plugin' | 'skill'

export interface PluginBrowserProps {
  installedPlugins: InstalledPlugin[]
  onInstall: (sourcePath: string, type: 'agent' | 'command' | 'skill') => void
  onUninstall: (filename: string, type: 'agent' | 'command' | 'skill') => void
  /** The type of items to show - 'plugin' or 'skill'. If not provided, shows tabs to switch between them. */
  kind?: PluginFilterType
}

const SORT_OPTIONS: Array<{ key: MarketplaceSort; labelKey: string }> = [
  { key: 'relevance', labelKey: 'plugins.sort.relevance' },
  { key: 'stars', labelKey: 'plugins.sort.stars' },
  { key: 'downloads', labelKey: 'plugins.sort.downloads' }
]

const SKELETON_CARD_COUNT = 6
const COUNT_SENTINEL = 123456789
const ROW_SIZE = 272
const LOADER_ROW_SIZE = 80

type PluginRow = {
  type: 'data' | 'loader' | 'error'
  entries: MarketplaceEntry[]
}

export const PluginBrowser: FC<PluginBrowserProps> = ({ installedPlugins, onInstall, onUninstall, kind }) => {
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [internalActiveType, setInternalActiveType] = useState<PluginFilterType>('plugin')

  // Use the provided kind prop if available, otherwise use internal state
  const activeType = kind ?? internalActiveType
  const showTypeTabs = kind === undefined
  const [sortOption, setSortOption] = useState<MarketplaceSort>('relevance')
  const [actioningPlugin, setActioningPlugin] = useState<string | null>(null)
  const [selectedPlugin, setSelectedPlugin] = useState<PluginMetadata | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)

  // Debounce search query
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value)
      setTimeoutTimer(
        'search-debounce',
        () => {
          setDebouncedSearchQuery(value.trim())
        },
        300
      )
    },
    [setTimeoutTimer]
  )

  const normalizedQuery = debouncedSearchQuery.trim()

  const {
    entries,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error: fetchError,
    loadMore,
    refetch
  } = useMarketplaceBrowser({
    kind: activeType,
    query: normalizedQuery,
    sort: sortOption
  })

  const isInitialLoading = isLoading && entries.length === 0
  const isInitialError = fetchError && entries.length === 0 && !isLoading
  const isLoadMoreError = fetchError && entries.length > 0 && !isLoadingMore

  const rows = useMemo<PluginRow[]>(() => {
    const nextRows: PluginRow[] = []
    for (let i = 0; i < entries.length; i += 2) {
      nextRows.push({ type: 'data', entries: entries.slice(i, i + 2) })
    }
    if (isLoadingMore) {
      nextRows.push({ type: 'loader', entries: [] })
    } else if (isLoadMoreError) {
      nextRows.push({ type: 'error', entries: [] })
    }
    return nextRows
  }, [entries, isLoadingMore, isLoadMoreError])

  const pluginTypeTabItems = useMemo(
    () => [
      {
        key: 'plugin',
        label: t('agent.settings.plugins.tab')
      },
      {
        key: 'skill',
        label: t('plugins.skills')
      }
    ],
    [t]
  )

  const sortLabel = useMemo(() => {
    const option = SORT_OPTIONS.find((item) => item.key === sortOption)
    return option ? t(option.labelKey) : ''
  }, [sortOption, t])

  const sortMenuItems = useMemo(
    () =>
      SORT_OPTIONS.map((option) => ({
        key: option.key,
        label: (
          <div className="flex flex-row justify-between">
            {t(option.labelKey)}
            {sortOption === option.key && <span className="ml-2 text-primary text-sm">✓</span>}
          </div>
        ),
        onClick: () => setSortOption(option.key)
      })),
    [sortOption, t]
  )

  const showingResultsKey = activeType === 'skill' ? 'plugins.showing_results_skills' : 'plugins.showing_results'
  const showingResultsTemplate = useMemo(() => t(showingResultsKey, { count: COUNT_SENTINEL }), [showingResultsKey, t])

  const showingResultsParts = useMemo(() => {
    const sentinel = String(COUNT_SENTINEL)
    const parts = showingResultsTemplate.split(sentinel)
    if (parts.length === 1) {
      return { prefix: showingResultsTemplate, suffix: '' }
    }
    const [prefix, ...rest] = parts
    return { prefix, suffix: rest.join(sentinel) }
  }, [showingResultsTemplate])

  // Find the installed plugin that matches a marketplace plugin
  const findInstalledPlugin = (plugin: PluginMetadata) => {
    const pluginName = plugin.name.toLowerCase()

    // Check by packageName (for plugin packages like agent-sdk-dev)
    const foundByPackage = installedPlugins.find(
      (installed) => installed.metadata.packageName?.toLowerCase() === pluginName
    )
    if (foundByPackage) return foundByPackage

    // Check by name directly (for skills)
    const foundByName = installedPlugins.find(
      (installed) => installed.metadata.name.toLowerCase() === pluginName && installed.type === plugin.type
    )
    return foundByName
  }

  const isPluginInstalled = (plugin: PluginMetadata): boolean => {
    return !!findInstalledPlugin(plugin)
  }

  // Handle install with loading state
  const handleInstall = async (plugin: PluginMetadata) => {
    setActioningPlugin(plugin.sourcePath)
    try {
      await onInstall(plugin.sourcePath, plugin.type)
    } finally {
      setActioningPlugin(null)
    }
  }

  // Handle uninstall with loading state
  const handleUninstall = async (plugin: PluginMetadata) => {
    setActioningPlugin(plugin.sourcePath)
    try {
      // Find the actual installed plugin to get its real filename
      const installed = findInstalledPlugin(plugin)
      if (installed) {
        await onUninstall(installed.metadata.filename, installed.type)
      }
    } finally {
      setActioningPlugin(null)
    }
  }

  const handleTypeChange = (type: string | number) => {
    setInternalActiveType(type as PluginFilterType)
  }

  const handlePluginClick = (plugin: PluginMetadata) => {
    setSelectedPlugin(plugin)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedPlugin(null)
  }

  const handleVirtualChange = useCallback(
    (instance: { scrollOffset: number | null; getTotalSize: () => number; scrollElement: HTMLElement | null }) => {
      if (!hasMore || isLoading || isLoadingMore) return
      const { scrollOffset, scrollElement } = instance
      if (!scrollElement || scrollOffset === null) return
      const clientHeight = scrollElement.clientHeight
      const totalSize = instance.getTotalSize()
      const distanceToBottom = totalSize - scrollOffset - clientHeight
      // Trigger load when within 200px of the bottom
      if (distanceToBottom < 200) {
        loadMore()
      }
    },
    [hasMore, isLoading, isLoadingMore, loadMore]
  )

  const skeletonCards = useMemo(
    () =>
      Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div
          key={`plugin-skeleton-${index}`}
          className="flex h-full flex-col gap-3 rounded-lg border border-default-200 p-4">
          <SkeletonSpan width="60%" />
          <div className="flex gap-2">
            <SkeletonSpan width="64px" />
            <SkeletonSpan width="64px" />
          </div>
          <SkeletonSpan width="90%" />
          <SkeletonSpan width="75%" />
          <div className="flex items-center gap-4">
            <SkeletonSpan width="48px" />
            <SkeletonSpan width="48px" />
          </div>
          <SkeletonSpan width="100%" />
        </div>
      )),
    []
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* Search and Sort */}
      <div className="flex gap-2">
        <AntInput
          placeholder={t('plugins.search_placeholder')}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          prefix={<Search className="h-4 w-4 text-default-400" />}
        />
        <Tooltip title={t('common.refresh')}>
          <AntButton
            variant="outlined"
            size="middle"
            className="flex aspect-square items-center justify-center"
            icon={<RefreshIcon size={16} className={isLoading ? 'animation-rotate' : ''} />}
            onClick={refetch}
            disabled={isLoading}
          />
        </Tooltip>
        <AntDropdown
          menu={{ items: sortMenuItems }}
          trigger={['click']}
          open={sortDropdownOpen}
          placement="bottomRight"
          onOpenChange={setSortDropdownOpen}>
          <AntButton variant="outlined" size="middle">
            {t('plugins.sort.label')}: {sortLabel}
          </AntButton>
        </AntDropdown>
      </div>

      {/* Type Tabs - only shown when kind prop is not provided */}
      {showTypeTabs && (
        <div className="-mb-3 flex w-full justify-center">
          <AntTabs
            activeKey={activeType}
            onChange={handleTypeChange}
            items={pluginTypeTabItems}
            className="w-full"
            size="small"
            centered
          />
        </div>
      )}

      {/* Result Count */}
      <div className="flex items-center gap-2">
        <p className="text-default-500 text-small">
          {isInitialLoading ? (
            <>
              {showingResultsParts.prefix}
              <SkeletonSpan width="48px" />
              {showingResultsParts.suffix}
            </>
          ) : (
            t(showingResultsKey, { count: total })
          )}
        </p>
      </div>

      {/* Plugin Grid */}
      {isInitialError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
          <AlertCircle className="h-12 w-12 text-default-300" />
          <div>
            <p className="text-default-500">{t('agent.settings.plugins.error.load')}</p>
            <p className="text-default-400 text-small">{fetchError}</p>
          </div>
          <AntButton type="primary" onClick={refetch}>
            {t('common.retry')}
          </AntButton>
        </div>
      ) : entries.length === 0 && !isInitialLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <p className="text-default-400">{t('plugins.no_results')}</p>
          <p className="text-default-300 text-small">{t('plugins.try_different_search')}</p>
        </div>
      ) : isInitialLoading ? (
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">{skeletonCards}</div>
      ) : (
        <DynamicVirtualList
          list={rows}
          estimateSize={(index) => (rows[index]?.type === 'loader' ? LOADER_ROW_SIZE : ROW_SIZE)}
          overscan={4}
          onChange={handleVirtualChange}
          size="100%"
          className="flex-1"
          scrollerStyle={{ paddingRight: '4px' }}>
          {(row) => {
            if (row.type === 'loader') {
              return (
                <div className="flex justify-center py-4">
                  <SkeletonSpan width="120px" />
                </div>
              )
            }

            if (row.type === 'error') {
              return (
                <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
                  <p className="text-default-400 text-small">{t('agent.settings.plugins.error.load_more')}</p>
                  <AntButton size="small" onClick={loadMore}>
                    {t('common.retry')}
                  </AntButton>
                </div>
              )
            }

            return (
              <div className="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2">
                {row.entries.map((entry) => {
                  const plugin = entry.metadata
                  const installed = isPluginInstalled(plugin)
                  const isActioning = actioningPlugin === plugin.sourcePath

                  return (
                    <div key={`${plugin.type}-${plugin.sourcePath}`} className="h-full">
                      <PluginCard
                        plugin={plugin}
                        stats={entry.stats}
                        installed={installed}
                        onInstall={() => handleInstall(plugin)}
                        onUninstall={() => handleUninstall(plugin)}
                        loading={isActioning}
                        onClick={() => handlePluginClick(plugin)}
                      />
                    </div>
                  )
                })}
              </div>
            )
          }}
        </DynamicVirtualList>
      )}

      {/* Plugin Detail Modal */}
      <PluginDetailModal
        plugin={selectedPlugin}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        installed={selectedPlugin ? isPluginInstalled(selectedPlugin) : false}
        onInstall={() => selectedPlugin && handleInstall(selectedPlugin)}
        onUninstall={() => selectedPlugin && handleUninstall(selectedPlugin)}
        loading={selectedPlugin ? actioningPlugin === selectedPlugin.sourcePath : false}
      />
    </div>
  )
}
