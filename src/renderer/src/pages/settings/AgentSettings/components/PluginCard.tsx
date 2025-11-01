import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Spinner } from '@heroui/react'
import type { PluginMetadata } from '@renderer/types/plugin'
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

  return (
    <Card
      className="flex h-full w-full cursor-pointer flex-col border-[0.5px] border-default-200"
      isPressable
      shadow="none"
      onPress={onClick}>
      <CardHeader className="flex flex-col items-start gap-2 pb-2">
        <div className="flex w-full items-center justify-between gap-2">
          <h3 className="truncate font-medium text-small">{plugin.name}</h3>
          <Chip
            size="sm"
            variant="solid"
            color={plugin.type === 'agent' ? 'primary' : plugin.type === 'skill' ? 'success' : 'secondary'}
            className="h-4 min-w-0 flex-shrink-0 px-0.5 text-xs">
            {upperFirst(plugin.type)}
          </Chip>
        </div>
        <Chip size="sm" variant="dot" color="default">
          {plugin.category}
        </Chip>
      </CardHeader>

      <CardBody className="flex-1 py-2">
        <p className="line-clamp-3 text-default-500 text-small">{plugin.description || t('plugins.no_description')}</p>

        {plugin.tags && plugin.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {plugin.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="bordered" className="text-tiny">
                {tag}
              </Chip>
            ))}
          </div>
        )}
      </CardBody>

      <CardFooter className="pt-2">
        {installed ? (
          <Button
            color="danger"
            variant="flat"
            size="sm"
            startContent={loading ? <Spinner size="sm" color="current" /> : <Trash2 className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation()
              onUninstall()
            }}
            isDisabled={loading}
            fullWidth>
            {loading ? t('plugins.uninstalling') : t('plugins.uninstall')}
          </Button>
        ) : (
          <Button
            color="primary"
            variant="flat"
            size="sm"
            startContent={loading ? <Spinner size="sm" color="current" /> : <Download className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation()
              onInstall()
            }}
            isDisabled={loading}
            fullWidth>
            {loading ? t('plugins.installing') : t('plugins.install')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
