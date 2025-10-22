import { Button, Chip, Skeleton, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@heroui/react'
import { InstalledPlugin } from '@renderer/types/plugin'
import { Trash2 } from 'lucide-react'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface InstalledPluginsListProps {
  plugins: InstalledPlugin[]
  onUninstall: (filename: string, type: 'agent' | 'command') => void
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
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
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

  return (
    <Table aria-label="Installed plugins table" removeWrapper>
      <TableHeader>
        <TableColumn>{t('plugins.name')}</TableColumn>
        <TableColumn>{t('plugins.type')}</TableColumn>
        <TableColumn>{t('plugins.category')}</TableColumn>
        <TableColumn width={100}>{t('plugins.actions')}</TableColumn>
      </TableHeader>
      <TableBody>
        {plugins.map((plugin) => (
          <TableRow key={plugin.filename}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-semibold text-small">{plugin.metadata.name}</span>
                {plugin.metadata.description && (
                  <span className="line-clamp-1 text-default-400 text-tiny">{plugin.metadata.description}</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Chip size="sm" variant="flat" color={plugin.type === 'agent' ? 'primary' : 'secondary'}>
                {plugin.type}
              </Chip>
            </TableCell>
            <TableCell>
              <Chip size="sm" variant="dot">
                {plugin.metadata.category}
              </Chip>
            </TableCell>
            <TableCell>
              <Button
                size="sm"
                color="danger"
                variant="light"
                isIconOnly
                onPress={() => handleUninstall(plugin)}
                isLoading={uninstallingPlugin === plugin.filename}
                isDisabled={loading}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
