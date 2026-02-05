import type { CodeMirrorTheme } from '@cherrystudio/ui'
import {
  Button,
  CodeEditor,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Spinner
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { parseJSON } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EditCapacityMetadataRootProps {
  metadata?: unknown
  onSave: (metadata: Record<string, unknown>) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  children?: React.ReactNode
}

interface EditCapacityMetadataContextValue {
  open: boolean
  jsonConfig: string
  jsonError: string
  isLoading: boolean
  isSaving: boolean
  fontSize: number
  activeCmTheme: CodeMirrorTheme
  setJsonConfig: (value: string) => void
  handleSave: () => void
  handleCancel: () => void
  handleOpenChange: (nextOpen: boolean) => void
}

const logger = loggerService.withContext('EditCapacityMetadataPopup')

const EditCapacityMetadataContext = createContext<EditCapacityMetadataContextValue | null>(null)

const useEditCapacityMetadata = () => {
  const context = use(EditCapacityMetadataContext)
  if (!context) {
    throw new Error('EditCapacityMetadataPopup components must be used within EditCapacityMetadataPopup.Root')
  }
  return context
}

const EditCapacityMetadataPopupRoot: React.FC<EditCapacityMetadataRootProps> = ({
  metadata,
  onSave,
  open,
  onOpenChange,
  children
}) => {
  const [jsonConfig, setJsonConfig] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    try {
      const baseMetadata = metadata ?? {}
      const formattedJson = JSON.stringify(baseMetadata, null, 2)
      setJsonConfig(formattedJson)
      setJsonError('')
    } catch (error) {
      logger.error('Failed to format capacity metadata JSON', error as Error)
      setJsonError('Invalid JSON format.')
    } finally {
      setIsLoading(false)
    }
  }, [metadata, open])

  const handleSave = useCallback(() => {
    setIsSaving(true)
    try {
      const trimmed = jsonConfig.trim()
      const parsedJson = trimmed ? parseJSON(trimmed) : {}
      if (parsedJson === null) {
        throw new Error('Invalid JSON format.')
      }
      onSave(parsedJson as Record<string, unknown>)
      window.toast.success(t('save.success'))
      setJsonError('')
      onOpenChange(false)
    } catch (error: unknown) {
      setJsonError(formatErrorMessage(error) || 'Invalid JSON format.')
      window.toast.error('Invalid JSON format.')
    } finally {
      setIsSaving(false)
    }
  }, [jsonConfig, onOpenChange, onSave, t])

  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const contextValue = useMemo<EditCapacityMetadataContextValue>(
    () => ({
      open,
      jsonConfig,
      jsonError,
      isLoading,
      isSaving,
      fontSize,
      activeCmTheme,
      setJsonConfig,
      handleSave,
      handleCancel,
      handleOpenChange
    }),
    [
      open,
      jsonConfig,
      jsonError,
      isLoading,
      isSaving,
      fontSize,
      activeCmTheme,
      handleSave,
      handleCancel,
      handleOpenChange
    ]
  )

  return (
    <EditCapacityMetadataContext value={contextValue}>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {children}
      </Dialog>
    </EditCapacityMetadataContext>
  )
}

const EditCapacityMetadataPopupHeader: React.FC = () => {
  const { t } = useTranslation()

  return (
    <DialogHeader>
      <DialogTitle>{t('settings.file_processing.metadata')}</DialogTitle>
    </DialogHeader>
  )
}

const EditCapacityMetadataPopupError: React.FC = () => {
  const { jsonError } = useEditCapacityMetadata()

  return (
    <div className="mb-4 flex justify-between">
      <FieldError className="w-full">{jsonError ? <pre>{jsonError}</pre> : null}</FieldError>
    </div>
  )
}

const EditCapacityMetadataPopupEditor: React.FC = () => {
  const { activeCmTheme, fontSize, isLoading, jsonConfig, setJsonConfig } = useEditCapacityMetadata()

  if (isLoading) {
    return <Spinner text="" className="w-full justify-center" />
  }

  return (
    <CodeEditor
      theme={activeCmTheme}
      fontSize={fontSize - 1}
      value={jsonConfig}
      language="json"
      onChange={(value) => setJsonConfig(value)}
      height="60vh"
      expanded={false}
      wrapped
      options={{
        lint: true,
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        keymap: true
      }}
    />
  )
}

const EditCapacityMetadataPopupFooter: React.FC = () => {
  const { handleCancel, handleSave, isLoading, isSaving } = useEditCapacityMetadata()
  const { t } = useTranslation()

  return (
    <DialogFooter>
      <Button variant="outline" onClick={handleCancel}>
        {t('common.cancel')}
      </Button>
      <Button onClick={handleSave} loading={isSaving} disabled={isLoading || isSaving}>
        {t('common.save')}
      </Button>
    </DialogFooter>
  )
}

const EditCapacityMetadataPopupView: React.FC<EditCapacityMetadataRootProps> = (props) => (
  <EditCapacityMetadataPopupRoot {...props}>
    <DialogContent className="sm:max-w-200" onInteractOutside={(event) => event.preventDefault()}>
      <EditCapacityMetadataPopupHeader />
      <EditCapacityMetadataPopupError />
      <EditCapacityMetadataPopupEditor />
      <EditCapacityMetadataPopupFooter />
    </DialogContent>
  </EditCapacityMetadataPopupRoot>
)

const EditCapacityMetadataPopup = {
  Root: EditCapacityMetadataPopupRoot,
  Header: EditCapacityMetadataPopupHeader,
  Error: EditCapacityMetadataPopupError,
  Editor: EditCapacityMetadataPopupEditor,
  Footer: EditCapacityMetadataPopupFooter,
  View: EditCapacityMetadataPopupView
}

export default EditCapacityMetadataPopup
