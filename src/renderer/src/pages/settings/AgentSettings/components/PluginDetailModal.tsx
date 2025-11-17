import type { PluginMetadata } from '@renderer/types/plugin'
import { Button, Input, Modal, Spin, Tag } from 'antd'
import { Dot, Download, Edit, Save, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export interface PluginDetailModalProps {
  agentId: string
  plugin: PluginMetadata | null
  isOpen: boolean
  onClose: () => void
  installed: boolean
  onInstall: () => void
  onUninstall: () => void
  loading: boolean
}

export const PluginDetailModal: FC<PluginDetailModalProps> = ({
  agentId,
  plugin,
  isOpen,
  onClose,
  installed,
  onInstall,
  onUninstall,
  loading
}) => {
  const { t } = useTranslation()
  const [content, setContent] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Fetch plugin content when modal opens or plugin changes
  useEffect(() => {
    if (!isOpen || !plugin) {
      setContent('')
      setContentError(null)
      setIsEditing(false)
      setEditedContent('')
      return
    }

    const fetchContent = async () => {
      setContentLoading(true)
      setContentError(null)
      setIsEditing(false)
      setEditedContent('')
      try {
        let sourcePath = plugin.sourcePath
        if (plugin.type === 'skill') {
          sourcePath = sourcePath + '/' + 'SKILL.md'
        }

        const result = await window.api.claudeCodePlugin.readContent(sourcePath)
        if (result.success) {
          setContent(result.data)
        } else {
          setContentError(`Failed to load content: ${result.error.type}`)
        }
      } catch (error) {
        setContentError(`Error loading content: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setContentLoading(false)
      }
    }

    fetchContent()
  }, [isOpen, plugin])

  const handleEdit = () => {
    setEditedContent(content)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditedContent('')
  }

  const handleSave = async () => {
    if (!plugin) return

    setSaving(true)
    try {
      const result = await window.api.claudeCodePlugin.writeContent({
        agentId,
        filename: plugin.filename,
        type: plugin.type,
        content: editedContent
      })

      if (result.success) {
        setContent(editedContent)
        setIsEditing(false)
        window.toast?.success('Plugin content saved successfully')
      } else {
        window.toast?.error(`Failed to save: ${result.error.type}`)
      }
    } catch (error) {
      window.toast?.error(`Error saving: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

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
              icon={<Dot size={14} strokeWidth={8} />}
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
                <Tag key={tool}>{tool}</Tag>
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
                <Tag key={tool}>{tool}</Tag>
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
                <Tag key={tag}>{tag}</Tag>
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

        {/* Content */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-small">Content</h3>
            {installed && !contentLoading && !contentError && (
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button
                      danger
                      variant="filled"
                      icon={<X className="h-3 w-3" />}
                      iconPosition="start"
                      onClick={handleCancelEdit}
                      disabled={saving}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      color="primary"
                      variant="filled"
                      icon={saving ? <Spin size="small" /> : <Save className="h-3 w-3" />}
                      onClick={handleSave}
                      disabled={saving}>
                      {t('common.save')}
                    </Button>
                  </>
                ) : (
                  <Button variant="filled" icon={<Edit className="h-3 w-3" />} onClick={handleEdit}>
                    {t('common.edit')}
                  </Button>
                )}
              </div>
            )}
          </div>
          {contentLoading ? (
            <div className="flex items-center justify-center py-4">
              <Spin size="small" />
            </div>
          ) : contentError ? (
            <div className="rounded-md bg-danger-50 p-3 text-danger text-small">{contentError}</div>
          ) : isEditing ? (
            <Input.TextArea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              autoSize={{ minRows: 20 }}
              classNames={{
                textarea: 'font-mono text-tiny'
              }}
            />
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-default-100 p-3 font-mono text-tiny">
              {content}
            </pre>
          )}
        </div>
      </div>
    </Modal>
  )

  return createPortal(modalContent, document.body)
}
