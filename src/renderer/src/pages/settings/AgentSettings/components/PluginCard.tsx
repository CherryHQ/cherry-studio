import type { PluginMetadata } from '@renderer/types/plugin'
import { Button, Card, Spin, Tag } from 'antd'
import { upperFirst } from 'lodash'
import { Download, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface PluginCardProps {
  plugin: PluginMetadata
  installed: boolean
  onInstall: () => void
  onUninstall: () => void
  loading: boolean
  onClick: () => void
}

export const PluginCard: FC<PluginCardProps> = ({ plugin, installed, onInstall, onUninstall, loading, onClick }) => {
  const { t } = useTranslation()

  const getTypeTagColor = () => {
    if (plugin.type === 'agent') return 'blue'
    if (plugin.type === 'skill') return 'green'
    return 'default'
  }

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
            {upperFirst(plugin.type)}
          </Tag>
        </div>
        <Tag className="m-0">{plugin.category}</Tag>
      </div>

      <div className="flex-1 py-2">
        <p className="line-clamp-3 text-gray-500 text-sm">{plugin.description || t('plugins.no_description')}</p>

        {plugin.tags && plugin.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {plugin.tags.map((tag) => (
              <Tag key={tag} bordered className="text-xs">
                {tag}
              </Tag>
            ))}
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
