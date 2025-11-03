import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Textarea
} from '@heroui/react'
import type { PluginMetadata } from '@renderer/types/plugin'
import { Download, Edit, Save, Trash2, X } from 'lucide-react'
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
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        wrapper: 'z-[9999]'
      }}>
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

          {/* Content */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-small">Content</h3>
              {installed && !contentLoading && !contentError && (
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        startContent={<X className="h-3 w-3" />}
                        onPress={handleCancelEdit}
                        isDisabled={saving}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        color="primary"
                        startContent={saving ? <Spinner size="sm" color="current" /> : <Save className="h-3 w-3" />}
                        onPress={handleSave}
                        isDisabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="flat" startContent={<Edit className="h-3 w-3" />} onPress={handleEdit}>
                      Edit
                    </Button>
                  )}
                </div>
              )}
            </div>
            {contentLoading ? (
              <div className="flex items-center justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : contentError ? (
              <div className="rounded-md bg-danger-50 p-3 text-danger text-small">{contentError}</div>
            ) : isEditing ? (
              <Textarea
                value={editedContent}
                onValueChange={setEditedContent}
                minRows={20}
                classNames={{
                  input: 'font-mono text-tiny'
                }}
              />
            ) : (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-default-100 p-3 font-mono text-tiny">
                {content}
              </pre>
            )}
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

  return createPortal(modalContent, document.body)
}
