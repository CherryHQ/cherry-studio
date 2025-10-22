import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Spinner } from '@heroui/react'
import { PluginMetadata } from '@renderer/types/plugin'
import { Download, Trash2 } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface PluginCardProps {
  plugin: PluginMetadata
  installed: boolean
  onInstall: () => void
  onUninstall: () => void
  loading: boolean
}

export const PluginCard: FC<PluginCardProps> = ({ plugin, installed, onInstall, onUninstall, loading }) => {
  const { t } = useTranslation()

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-col items-start gap-2 pb-2">
        <div className="flex w-full items-center justify-between">
          <h3 className="font-semibold text-medium">{plugin.name}</h3>
          <Chip size="sm" variant="solid" color={plugin.type === 'agent' ? 'primary' : 'secondary'}>
            {plugin.type}
          </Chip>
        </div>
        <Chip size="sm" variant="dot" color="default">
          {plugin.category}
        </Chip>
      </CardHeader>

      <CardBody className="py-2">
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
            onPress={onUninstall}
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
            onPress={onInstall}
            isDisabled={loading}
            fullWidth>
            {loading ? t('plugins.installing') : t('plugins.install')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
