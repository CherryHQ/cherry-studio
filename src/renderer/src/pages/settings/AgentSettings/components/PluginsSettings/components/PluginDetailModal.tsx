import type { PluginMetadata } from '@renderer/types/plugin'
import { Button, Modal, Spin, Tag } from 'antd'
import { Download, Trash2 } from 'lucide-react'
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

  const modalContent = (
    <Modal
      centered
      open={isOpen}
      onCancel={onClose}
      styles={{
        body: {
          maxHeight: '60vh',
          overflowY: 'auto'
        }
      }}
      style={{
        width: '70%'
      }}
      title={
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-xl">{plugin.name}</h2>
            <Tag color={plugin.type === 'agent' ? 'magenta' : 'purple'}>{plugin.type}</Tag>
          </div>
          <div className="flex items-center gap-2">
            <Tag
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '2px'
              }}>
              {plugin.category}
            </Tag>
            {plugin.version && <Tag>v{plugin.version}</Tag>}
          </div>
        </div>
      }
      footer={
        <div className="flex flex-row justify-end gap-4">
          <Button type="text" onClick={onClose}>
            {t('common.close')}
          </Button>
          {installed ? (
            <Button
              danger
              variant="filled"
              icon={loading ? <Spin size="small" /> : <Trash2 className="h-4 w-4" />}
              iconPosition={'start'}
              onClick={onUninstall}
              disabled={loading}>
              {loading ? t('plugins.uninstalling') : t('plugins.uninstall')}
            </Button>
          ) : (
            <Button
              color="primary"
              variant="solid"
              icon={loading ? <Spin size="small" /> : <Download className="h-4 w-4" />}
              iconPosition={'start'}
              onClick={onInstall}
              disabled={loading}>
              {loading ? t('plugins.installing') : t('plugins.install')}
            </Button>
          )}
        </div>
      }>
      <div>
        {/* Description */}
        {plugin.description && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.description')}</h3>
            <p className="text-default-600 text-small">{plugin.description}</p>
          </div>
        )}

        {/* Author */}
        {plugin.author && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.author')}</h3>
            <p className="text-default-600 text-small">{plugin.author}</p>
          </div>
        )}

        {/* Tools (for agents) */}
        {plugin.tools && plugin.tools.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.tools')}</h3>
            <div className="flex flex-wrap gap-1">
              {plugin.tools.map((tool) => (
                <Tag key={tool}>{tool}</Tag>
              ))}
            </div>
          </div>
        )}

        {/* Allowed Tools (for commands) */}
        {plugin.allowed_tools && plugin.allowed_tools.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.allowed_tools')}</h3>
            <div className="flex flex-wrap gap-1">
              {plugin.allowed_tools.map((tool) => (
                <Tag key={tool}>{tool}</Tag>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {plugin.tags && plugin.tags.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.tags')}</h3>
            <div className="flex flex-wrap gap-1">
              {plugin.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="mb-4">
          <h3 className="mb-2 font-semibold text-small">{t('plugins.detail.metadata')}</h3>
          <div className="space-y-1 text-small">
            <div className="flex justify-between">
              <span className="text-default-500">{t('plugins.detail.file')}:</span>
              <span className="font-mono text-default-600 text-tiny">{plugin.filename}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-500">{t('plugins.detail.size')}:</span>
              <span className="text-default-600">{(plugin.size / 1024).toFixed(2)} KB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-500">{t('plugins.detail.source')}:</span>
              <span className="font-mono text-default-600 text-tiny">{plugin.sourcePath}</span>
            </div>
            {plugin.installedAt && (
              <div className="flex justify-between">
                <span className="text-default-500">{t('plugins.detail.installed')}:</span>
                <span className="text-default-600">{new Date(plugin.installedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )

  return createPortal(modalContent, document.body)
}
