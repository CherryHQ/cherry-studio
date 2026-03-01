import type { PluginMetadata } from '@renderer/types/plugin'
import { Button, Modal, Spin, Tag } from 'antd'
import { Download, Hash, Layers, Package, User } from 'lucide-react'
import type { FC } from 'react'
import { createPortal } from 'react-dom'
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

  const isAgent = plugin.type === 'agent'

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  const modalContent = (
    <Modal
      centered
      open={isOpen}
      onCancel={onClose}
      footer={null}
      width={560}
      title={
        <div className="flex flex-col gap-1">
          {/* Name and type row */}
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-lg">{plugin.name}</h2>
            <Tag color={isAgent ? 'cyan' : 'purple'}>{plugin.type}</Tag>
          </div>
          {/* Category and version row */}
          <div className="flex items-center gap-2">
            <Tag bordered>{plugin.category}</Tag>
            {plugin.version && <span className="text-default-400 text-sm">v{plugin.version}</span>}
          </div>
        </div>
      }>
      <div className="space-y-4">
        {/* Description */}
        {plugin.description && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
              <Package className="h-4 w-4" />
              {t('plugins.detail.description')}
            </h3>
            <p className="text-default-600 text-sm leading-relaxed">{plugin.description}</p>
          </div>
        )}

        {/* Author */}
        {plugin.author && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
              <User className="h-4 w-4" />
              {t('plugins.detail.author')}
            </h3>
            <p className="text-default-600 text-sm">{plugin.author}</p>
          </div>
        )}

        {/* Tools (for agents) */}
        {plugin.tools && plugin.tools.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
              <Layers className="h-4 w-4" />
              {t('plugins.detail.tools')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {plugin.tools.map((tool) => (
                <Tag key={tool} color="cyan" className="font-mono text-xs">
                  {tool}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* Allowed Tools (for commands) */}
        {plugin.allowed_tools && plugin.allowed_tools.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
              <Hash className="h-4 w-4" />
              {t('plugins.detail.allowed_tools')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {plugin.allowed_tools.map((tool) => (
                <Tag key={tool} color="purple" className="font-mono text-xs">
                  {tool}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {plugin.tags && plugin.tags.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
              <Hash className="h-4 w-4" />
              {t('plugins.detail.tags')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {plugin.tags.map((tag) => (
                <Tag key={tag} bordered>
                  {tag}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div>
          <h3 className="mb-2 flex items-center gap-2 font-medium text-default-500 text-sm">
            <Package className="h-4 w-4" />
            {t('plugins.detail.metadata')}
          </h3>
          <div className="space-y-0 rounded-lg border border-default-200 p-4 text-sm dark:border-default-700">
            <div className="flex justify-between border-default-200 border-b pb-2 last:border-0 dark:border-default-700">
              <span className="text-default-400">{t('plugins.detail.file')}:</span>
              <span className="max-w-[60%] break-all text-right font-mono text-default-600 text-xs">
                {plugin.filename}
              </span>
            </div>
            {plugin.size && (
              <div className="flex justify-between border-default-200 border-b py-2 last:border-0 dark:border-default-700">
                <span className="text-default-400">{t('plugins.detail.size')}:</span>
                <span className="text-default-600">{formatSize(plugin.size)}</span>
              </div>
            )}
            <div className="flex justify-between border-default-200 border-b py-2 last:border-0 dark:border-default-700">
              <span className="text-default-400">{t('plugins.detail.source')}:</span>
              <span className="max-w-[60%] break-all text-right font-mono text-default-500 text-xs">
                {plugin.sourcePath}
              </span>
            </div>
            {plugin.installedAt && (
              <div className="flex justify-between border-default-200 border-b py-2 last:border-0 dark:border-default-700">
                <span className="text-default-400">{t('plugins.detail.installed')}:</span>
                <span className="text-default-600">{new Date(plugin.installedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-end gap-3 border-default-200 border-t pt-4 dark:border-default-700">
        <Button type="default" onClick={onClose}>
          {t('common.close')}
        </Button>

        {installed ? (
          <Button
            danger
            variant="filled"
            onClick={onUninstall}
            disabled={loading}
            icon={loading ? <Spin size="small" /> : undefined}>
            {loading ? t('plugins.uninstalling') : t('plugins.uninstall')}
          </Button>
        ) : (
          <Button
            type="primary"
            onClick={onInstall}
            disabled={loading}
            icon={loading ? <Spin size="small" /> : <Download className="h-4 w-4" />}>
            {loading ? t('plugins.installing') : t('plugins.install')}
          </Button>
        )}
      </div>
    </Modal>
  )

  return createPortal(modalContent, document.body)
}
