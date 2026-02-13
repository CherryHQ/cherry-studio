import type { PluginMetadata } from '@renderer/types/plugin'
import { Button, Card, Spin, Tag } from 'antd'
import { t } from 'i18next'
import { Download, Star, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface PluginCardProps {
  plugin: PluginMetadata
  stats?: {
    stars: number
    downloads: number
  }
  installed: boolean
  onInstall: () => void
  onUninstall: () => void
  loading: boolean
  onClick: () => void
}

const labelMap = {
  skill: t('plugins.skills'),
  agent: t('plugins.agents'),
  command: t('plugins.commands')
}

export const PluginCard: FC<PluginCardProps> = ({
  plugin,
  stats,
  installed,
  onInstall,
  onUninstall,
  loading,
  onClick
}) => {
  const { t } = useTranslation()
  const maxTags = 3
  const tags = plugin.tags ?? []
  const visibleTags = tags.slice(0, maxTags)
  const remainingTags = tags.length - visibleTags.length

  const isMarketplacePlugin = plugin.sourcePath.startsWith('marketplace:') && plugin.type !== 'skill'

  const getTypeTagColor = () => {
    if (isMarketplacePlugin) return 'default'
    if (plugin.type === 'agent') return 'blue'
    if (plugin.type === 'skill') return 'green'
    return 'default'
  }

  const getTypeLabel = () => {
    if (isMarketplacePlugin) return t('agent.settings.plugins.tab')
    return labelMap[plugin.type]
  }

  const formatCount = (value: number) =>
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value)

  return (
    <Card
      className="flex h-full w-full cursor-pointer flex-col"
      onClick={onClick}
      styles={{
        body: { display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' }
      }}>
      <div className="flex flex-col items-start gap-2 pb-2">
        <div className="flex w-full items-center justify-between gap-2">
          <h3 className="truncate font-medium text-sm">{plugin.name}</h3>
          <Tag color={getTypeTagColor()} className="m-0 text-xs">
            {getTypeLabel()}
          </Tag>
        </div>
        <Tag className="m-0">{plugin.category}</Tag>
      </div>

      <div className="flex-1 py-2">
        <p className="line-clamp-3 text-gray-500 text-sm">{plugin.description || t('plugins.no_description')}</p>

        {visibleTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleTags.map((tag) => (
              <Tag key={tag} bordered className="text-xs">
                {tag}
              </Tag>
            ))}
            {remainingTags > 0 && (
              <Tag bordered className="text-xs">
                +{remainingTags}
              </Tag>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 text-default-400 text-xs">
        {stats && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {formatCount(stats.stars)}
            </span>
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {formatCount(stats.downloads)}
            </span>
          </div>
        )}
      </div>

      <div className="pt-2">
        {installed ? (
          <Button
            danger
            type="primary"
            size="small"
            icon={loading ? <Spin size="small" /> : <Trash2 className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation()
              onUninstall()
            }}
            disabled={loading}
            block>
            {loading ? t('plugins.uninstalling') : t('plugins.uninstall')}
          </Button>
        ) : (
          <Button
            type="primary"
            size="small"
            icon={loading ? <Spin size="small" /> : <Download className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation()
              onInstall()
            }}
            disabled={loading}
            block>
            {loading ? t('plugins.installing') : t('plugins.install')}
          </Button>
        )}
      </div>
    </Card>
  )
}
