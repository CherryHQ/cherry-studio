import { Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner } from '@heroui/react'
import { PluginMetadata } from '@renderer/types/plugin'
import { Download, Trash2 } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface PluginDetailModalProps {
  plugin: PluginMetadata | null
  isOpen: boolean
  onClose: () => void
  installed: boolean
  onInstall: () => void
  onUninstall: () => void
  loading: boolean
}

export const PluginDetailModal: FC<PluginDetailModalProps> = ({
  plugin,
  isOpen,
  onClose,
  installed,
  onInstall,
  onUninstall,
  loading
}) => {
  const { t } = useTranslation()

  if (!plugin) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-xl">{plugin.name}</h2>
            <Chip size="sm" variant="solid" color={plugin.type === 'agent' ? 'primary' : 'secondary'}>
              {plugin.type}
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="dot" color="default">
              {plugin.category}
            </Chip>
            {plugin.version && (
              <Chip size="sm" variant="bordered">
                v{plugin.version}
              </Chip>
            )}
          </div>
        </ModalHeader>

        <ModalBody>
          {/* Description */}
          {plugin.description && (
            <div className="mb-4">
              <h3 className="mb-2 font-semibold text-small">Description</h3>
              <p className="text-default-600 text-small">{plugin.description}</p>
            </div>
          )}

          {/* Author */}
          {plugin.author && (
            <div className="mb-4">
              <h3 className="mb-2 font-semibold text-small">Author</h3>
              <p className="text-default-600 text-small">{plugin.author}</p>
            </div>
          )}

          {/* Tools (for agents) */}
          {plugin.tools && plugin.tools.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 font-semibold text-small">Tools</h3>
              <div className="flex flex-wrap gap-1">
                {plugin.tools.map((tool) => (
                  <Chip key={tool} size="sm" variant="flat">
                    {tool}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Allowed Tools (for commands) */}
          {plugin.allowed_tools && plugin.allowed_tools.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 font-semibold text-small">Allowed Tools</h3>
              <div className="flex flex-wrap gap-1">
                {plugin.allowed_tools.map((tool) => (
                  <Chip key={tool} size="sm" variant="flat">
                    {tool}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {plugin.tags && plugin.tags.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 font-semibold text-small">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {plugin.tags.map((tag) => (
                  <Chip key={tag} size="sm" variant="bordered">
                    {tag}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">Metadata</h3>
            <div className="space-y-1 text-small">
              <div className="flex justify-between">
                <span className="text-default-500">File:</span>
                <span className="font-mono text-default-600 text-tiny">{plugin.filename}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-default-500">Size:</span>
                <span className="text-default-600">{(plugin.size / 1024).toFixed(2)} KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-default-500">Source:</span>
                <span className="font-mono text-default-600 text-tiny">{plugin.sourcePath}</span>
              </div>
              {plugin.installedAt && (
                <div className="flex justify-between">
                  <span className="text-default-500">Installed:</span>
                  <span className="text-default-600">{new Date(plugin.installedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            Close
          </Button>
          {installed ? (
            <Button
              color="danger"
              variant="flat"
              startContent={loading ? <Spinner size="sm" color="current" /> : <Trash2 className="h-4 w-4" />}
              onPress={onUninstall}
              isDisabled={loading}>
              {loading ? t('plugins.uninstalling') : t('plugins.uninstall')}
            </Button>
          ) : (
            <Button
              color="primary"
              startContent={loading ? <Spinner size="sm" color="current" /> : <Download className="h-4 w-4" />}
              onPress={onInstall}
              isDisabled={loading}>
              {loading ? t('plugins.installing') : t('plugins.install')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
