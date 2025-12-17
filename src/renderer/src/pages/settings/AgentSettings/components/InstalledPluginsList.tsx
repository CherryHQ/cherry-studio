import type { InstalledPlugin } from '@renderer/types/plugin'
import type { TableProps } from 'antd'
import { Button, Skeleton, Table as AntTable, Tag } from 'antd'
import { Dot, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface InstalledPluginsListProps {
  plugins: InstalledPlugin[]
  onUninstall: (filename: string, type: 'agent' | 'command' | 'skill') => void
  loading: boolean
}

export const InstalledPluginsList: FC<InstalledPluginsListProps> = ({ plugins, onUninstall, loading }) => {
  const { t } = useTranslation()
  const [uninstallingPlugin, setUninstallingPlugin] = useState<string | null>(null)

  const handleUninstall = useCallback(
    (plugin: InstalledPlugin) => {
      const confirmed = window.confirm(
        t('plugins.confirm_uninstall', { name: plugin.metadata.name || plugin.filename })
      )

      if (confirmed) {
        setUninstallingPlugin(plugin.filename)
        onUninstall(plugin.filename, plugin.type)
        // Reset after a delay to allow the operation to complete
        setTimeout(() => setUninstallingPlugin(null), 2000)
      }
    },
    [onUninstall, t]
  )

  if (loading) {
    return (
      <div className="flex flex-col space-y-2">
        <Skeleton.Input active className="w-full" size={'large'} style={{ width: '100%' }} />
        <Skeleton.Input active className="w-full" size={'large'} style={{ width: '100%' }} />
        <Skeleton.Input active className="w-full" size={'large'} style={{ width: '100%' }} />
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-default-400">{t('plugins.no_installed_plugins')}</p>
        <p className="text-default-300 text-small">{t('plugins.install_plugins_from_browser')}</p>
      </div>
    )
  }

  const columns: TableProps<InstalledPlugin>['columns'] = [
    {
      title: t('plugins.name'),
      dataIndex: 'name',
      key: 'name',
      render: (_: any, plugin: InstalledPlugin) => (
        <div className="flex flex-col">
          <span className="font-semibold text-small">{plugin.metadata.name}</span>
          {plugin.metadata.description && (
            <span className="line-clamp-1 text-default-400 text-tiny">{plugin.metadata.description}</span>
          )}
        </div>
      )
    },
    {
      title: t('plugins.type'),
      dataIndex: 'type',
      key: 'type',
      align: 'center',
      render: (type: string) => <Tag color={type === 'agent' ? 'magenta' : 'purple'}>{type}</Tag>
    },
    {
      title: t('plugins.category'),
      dataIndex: 'category',
      key: 'category',
      align: 'center',
      render: (_: any, plugin: InstalledPlugin) => (
        <Tag
          icon={<Dot size={14} strokeWidth={8} />}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '2px'
          }}>
          {plugin.metadata.category}
        </Tag>
      )
    },
    {
      title: t('plugins.actions'),
      key: 'actions',
      align: 'center',
      render: (_: any, plugin: InstalledPlugin) => (
        <Button
          danger
          type="text"
          onClick={() => handleUninstall(plugin)}
          loading={uninstallingPlugin === plugin.filename}
          disabled={loading}
          icon={<Trash2 className="h-4 w-4" />}
        />
      )
    }
  ]

  return <AntTable columns={columns} dataSource={plugins} size="small" />
}
