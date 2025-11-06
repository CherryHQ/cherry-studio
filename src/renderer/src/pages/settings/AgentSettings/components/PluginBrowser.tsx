import type { InstalledPlugin, PluginMetadata } from '@renderer/types/plugin'
import { Button as AntButton, Dropdown as AntDropdown, Input as AntInput, Tabs as AntTabs } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { Filter, Search } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PluginCard } from './PluginCard'
import { PluginDetailModal } from './PluginDetailModal'

export interface PluginBrowserProps {
  agentId: string
  agents: PluginMetadata[]
  commands: PluginMetadata[]
  skills: PluginMetadata[]
  installedPlugins: InstalledPlugin[]
  onInstall: (sourcePath: string, type: 'agent' | 'command' | 'skill') => void
  onUninstall: (filename: string, type: 'agent' | 'command' | 'skill') => void
  loading: boolean
}

type PluginType = 'all' | 'agent' | 'command' | 'skill'

const ITEMS_PER_PAGE = 12

export const PluginBrowser: FC<PluginBrowserProps> = ({
  agentId,
  agents,
  commands,
  skills,
  installedPlugins,
  onInstall,
  onUninstall,
  loading
}) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [activeType, setActiveType] = useState<PluginType>('all')
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE)
  const [actioningPlugin, setActioningPlugin] = useState<string | null>(null)
  const [selectedPlugin, setSelectedPlugin] = useState<PluginMetadata | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const observerTarget = useRef<HTMLDivElement>(null)
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)

  // Combine all plugins based on active type
  const allPlugins = useMemo(() => {
    switch (activeType) {
      case 'agent':
        return agents
      case 'command':
        return commands
      case 'skill':
        return skills
      case 'all':
      default:
        return [...agents, ...commands, ...skills]
    }
  }, [agents, commands, skills, activeType])

  // Extract all unique categories
  const allCategories = useMemo(() => {
    const categories = new Set<string>()
    allPlugins.forEach((plugin) => {
      if (plugin.category) {
        categories.add(plugin.category)
      }
    })
    return Array.from(categories).sort()
  }, [allPlugins])

  // Filter plugins based on search query and selected categories
  const filteredPlugins = useMemo(() => {
    return allPlugins.filter((plugin) => {
      // Filter by search query
      const searchLower = searchQuery.toLowerCase()
      const matchesSearch =
        !searchQuery ||
        plugin.name.toLowerCase().includes(searchLower) ||
        plugin.description?.toLowerCase().includes(searchLower) ||
        plugin.tags?.some((tag) => tag.toLowerCase().includes(searchLower))

      // Filter by selected categories
      const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(plugin.category)

      return matchesSearch && matchesCategory
    })
  }, [allPlugins, searchQuery, selectedCategories])

  // Display plugins based on displayCount
  const displayedPlugins = useMemo(() => {
    return filteredPlugins.slice(0, displayCount)
  }, [filteredPlugins, displayCount])

  const pluginCategoryMenuItems = useMemo(() => {
    const isSelected = (category: string): boolean =>
      category === 'all' ? selectedCategories.length === 0 : selectedCategories.includes(category)
    const handleClick = (category: string) => {
      if (category === 'all') {
        handleCategoryChange(new Set(['all']))
      } else {
        const newKeys = selectedCategories.includes(category)
          ? new Set(selectedCategories.filter((c) => c !== category))
          : new Set([...selectedCategories, category])
        handleCategoryChange(newKeys)
      }
    }

    const itemLabel = (category: string) => (
      <div className="flex flex-row justify-between">
        {category}
        {isSelected(category) && <span className="ml-2 text-primary text-sm">✓</span>}
      </div>
    )

    return [
      {
        key: 'all',
        title: t('plugins.all_categories'),
        label: itemLabel('all'),
        onClick: () => handleClick('all')
      },
      ...allCategories.map(
        (category) =>
          ({
            key: category,
            title: category,
            label: itemLabel(category),
            onClick: () => handleClick(category)
          }) satisfies ItemType
      )
    ]
  }, [allCategories, selectedCategories, t])

  const pluginTypeTabItems = useMemo(
    () => [
      {
        key: 'all',
        label: t('plugins.all_types')
      },
      {
        key: 'agent',
        label: t('plugins.agents')
      },
      {
        key: 'command',
        label: t('plugins.commands')
      },
      {
        key: 'skill',
        label: t('plugins.skills')
      }
    ],
    [t]
  )

  const hasMore = displayCount < filteredPlugins.length

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE)
  }, [filteredPlugins])

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setDisplayCount((prev) => prev + ITEMS_PER_PAGE)
        }
      },
      { threshold: 0.1 }
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => observer.disconnect()
  }, [hasMore])

  // Check if a plugin is installed
  const isPluginInstalled = (plugin: PluginMetadata): boolean => {
    return installedPlugins.some(
      (installed) => installed.filename === plugin.filename && installed.type === plugin.type
    )
  }

  // Handle install with loading state
  const handleInstall = async (plugin: PluginMetadata) => {
    setActioningPlugin(plugin.sourcePath)
    await onInstall(plugin.sourcePath, plugin.type)
    setActioningPlugin(null)
  }

  // Handle uninstall with loading state
  const handleUninstall = async (plugin: PluginMetadata) => {
    setActioningPlugin(plugin.sourcePath)
    await onUninstall(plugin.filename, plugin.type)
    setActioningPlugin(null)
  }

  // Reset display count when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
  }

  const handleCategoryChange = (keys: Set<string>) => {
    // Reset if "all" selected, otherwise filter categories
    if (keys.has('all') || keys.size === 0) {
      setSelectedCategories([])
    } else {
      setSelectedCategories(Array.from(keys).filter((key) => key !== 'all'))
    }
  }

  const handleTypeChange = (type: string | number) => {
    setActiveType(type as PluginType)
  }

  const handlePluginClick = (plugin: PluginMetadata) => {
    setSelectedPlugin(plugin)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedPlugin(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Filter */}
      <div className="flex gap-2">
        <AntInput
          placeholder={t('plugins.search_placeholder')}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          prefix={<Search className="h-4 w-4 text-default-400" />}
        />
        <AntDropdown
          menu={{ items: pluginCategoryMenuItems }}
          trigger={['click']}
          open={filterDropdownOpen}
          placement="bottomRight"
          onOpenChange={setFilterDropdownOpen}>
          <AntButton
            variant={selectedCategories.length > 0 ? 'filled' : 'outlined'}
            color={selectedCategories.length > 0 ? 'primary' : 'default'}
            size="middle"
            icon={<Filter className="h-4 w-4" color="var(--color-text-2)" />}
          />
        </AntDropdown>
      </div>

      {/* Type Tabs */}
      <div className="-mb-3 flex w-full justify-center">
        <AntTabs
          activeKey={activeType}
          onChange={handleTypeChange}
          items={pluginTypeTabItems}
          className="w-full"
          size="small"
        />
      </div>

      {/* Result Count */}
      <div className="flex items-center justify-between">
        <p className="text-default-500 text-small">{t('plugins.showing_results', { count: filteredPlugins.length })}</p>
      </div>

      {/* Plugin Grid */}
      {displayedPlugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-default-400">{t('plugins.no_results')}</p>
          <p className="text-default-300 text-small">{t('plugins.try_different_search')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {displayedPlugins.map((plugin) => {
              const installed = isPluginInstalled(plugin)
              const isActioning = actioningPlugin === plugin.sourcePath

              return (
                <div key={`${plugin.type}-${plugin.sourcePath}`} className="h-full">
                  <PluginCard
                    plugin={plugin}
                    installed={installed}
                    onInstall={() => handleInstall(plugin)}
                    onUninstall={() => handleUninstall(plugin)}
                    loading={loading || isActioning}
                    onClick={() => handlePluginClick(plugin)}
                  />
                </div>
              )
            })}
          </div>
          {/* Infinite scroll trigger */}
          {hasMore && <div ref={observerTarget} className="h-10" />}
        </>
      )}

      {/* Plugin Detail Modal */}
      <PluginDetailModal
        agentId={agentId}
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
