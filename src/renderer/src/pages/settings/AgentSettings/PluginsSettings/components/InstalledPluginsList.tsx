import { useTimer } from '@renderer/hooks/useTimer'
import type { InstalledPlugin } from '@renderer/types/plugin'
import type { TableProps } from 'antd'
import { Button, Skeleton, Table as AntTable, Tag } from 'antd'
import { Package, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface InstalledPluginsListProps {
  plugins: InstalledPlugin[]
  onUninstall: (filename: string, type: 'agent' | 'command' | 'skill') => void
  onUninstallPackage?: (packageName: string) => void
  loading: boolean
  uninstallingPackage?: boolean
}

interface PluginGroup {
  packageName: string | null
  plugins: InstalledPlugin[]
}

export const InstalledPluginsList: FC<InstalledPluginsListProps> = ({
  plugins,
  onUninstall,
  onUninstallPackage,
  loading,
  uninstallingPackage
}) => {
  const { t } = useTranslation()
  const [uninstallingPlugin, setUninstallingPlugin] = useState<string | null>(null)
  const [uninstallingPackageName, setUninstallingPackageName] = useState<string | null>(null)
  const { setTimeoutTimer } = useTimer()

  // Group plugins by packageName
  const pluginGroups = useMemo((): PluginGroup[] => {
    const groups = new Map<string | null, InstalledPlugin[]>()

    for (const plugin of plugins) {
      const packageName = plugin.metadata.packageName || null
      const existing = groups.get(packageName) || []
      groups.set(packageName, [...existing, plugin])
    }

    // Convert to array, with standalone plugins (null packageName) last
    const result: PluginGroup[] = []
    const standalonePlugins = groups.get(null)

    for (const [packageName, groupPlugins] of groups) {
      if (packageName !== null) {
        result.push({ packageName, plugins: groupPlugins })
      }
    }

    if (standalonePlugins && standalonePlugins.length > 0) {
      result.push({ packageName: null, plugins: standalonePlugins })
    }

    return result
  }, [plugins])

  const handleUninstall = useCallback(
    (plugin: InstalledPlugin) => {
      const confirmed = window.confirm(
        t('plugins.confirm_uninstall', { name: plugin.metadata.name || plugin.filename })
      )

      if (confirmed) {
        setUninstallingPlugin(plugin.filename)
        onUninstall(plugin.filename, plugin.type)
        setTimeoutTimer('uninstall', () => setUninstallingPlugin(null), 2000)
      }
    },
    [onUninstall, t, setTimeoutTimer]
  )

  const handleUninstallPackage = useCallback(
    (packageName: string) => {
      const confirmed = window.confirm(
        t('plugins.confirm_uninstall_package', { name: packageName }) ||
          `Are you sure you want to uninstall the entire package "${packageName}"?`
      )

      if (confirmed && onUninstallPackage) {
        setUninstallingPackageName(packageName)
        onUninstallPackage(packageName)
        // Reset after a delay to allow the operation to complete
        setTimeoutTimer('uninstall-package', () => setUninstallingPackageName(null), 2000)
      }
    },
    [onUninstallPackage, t, setTimeoutTimer]
  )

  if (loading) {
    return (
      <div className="flex flex-col space-y-2">
        <Skeleton.Node active className="w-full" style={{ width: '100%', height: 180, borderRadius: 10 }} />
        <Skeleton.Node active className="w-full" style={{ width: '100%', height: 180, borderRadius: 10 }} />
        <Skeleton.Node active className="w-full" style={{ width: '100%', height: 180, borderRadius: 10 }} />
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
      render: (_: unknown, plugin: InstalledPlugin) => (
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
      render: (_: unknown, plugin: InstalledPlugin) => (
        <Tag
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
      render: (_: unknown, plugin: InstalledPlugin) => (
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

  // If there are package groups, render grouped view
  if (pluginGroups.some((g) => g.packageName !== null)) {
    return (
      <div className="flex flex-col gap-4">
        {pluginGroups.map((group) => (
          <div key={group.packageName || 'standalone'} className="rounded-lg border border-default-200 p-3">
            {/* Package header */}
            <div className="mb-2 flex items-center justify-between border-default-100 border-b pb-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-default-400" />
                <span className="font-medium">
                  {group.packageName || t('plugins.standalone_plugins') || 'Standalone Plugins'}
                </span>
                <Tag className="ml-2">{group.plugins.length}</Tag>
              </div>
              {group.packageName && onUninstallPackage && (
                <Button
                  danger
                  type="text"
                  size="small"
                  onClick={() => handleUninstallPackage(group.packageName!)}
                  loading={uninstallingPackage && uninstallingPackageName === group.packageName}
                  icon={<Trash2 className="h-3 w-3" />}>
                  {t('plugins.uninstall_package') || 'Uninstall Package'}
                </Button>
              )}
            </div>
            {/* Plugin table */}
            <AntTable
              columns={columns}
              dataSource={group.plugins}
              size="small"
              pagination={false}
              rowKey={(plugin) => `${plugin.filename}-${plugin.type}`}
            />
          </div>
        ))}
      </div>
    )
  }

  // Simple flat view for standalone plugins only
  return (
    <AntTable
      columns={columns}
      dataSource={plugins}
      size="small"
      rowKey={(plugin) => `${plugin.filename}-${plugin.type}`}
    />
  )
}
