import {
  Button,
  CodeEditor,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { safeValidateMcpConfig } from '@renderer/types'
import { parseJSON } from '@renderer/utils'
import { formatErrorMessage, formatZodError } from '@renderer/utils/error'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('EditMcpJsonPopup')

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [jsonConfig, setJsonConfig] = useState('')
  const [jsonSaving, setJsonSaving] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const { mcpServers, refetch } = useMCPServers()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const { t } = useTranslation()

  useEffect(() => {
    setIsLoading(true)
    try {
      const mcpServersObj: Record<string, any> = {}

      mcpServers.forEach((server) => {
        const { id, ...serverData } = server
        mcpServersObj[id] = serverData
      })

      const standardFormat = {
        mcpServers: mcpServersObj
      }

      const formattedJson = JSON.stringify(standardFormat, null, 2)
      setJsonConfig(formattedJson)
      setJsonError('')
    } catch (error) {
      logger.error('Failed to format JSON:', error as Error)
      setJsonError(t('settings.mcp.jsonFormatError'))
    } finally {
      setIsLoading(false)
    }
  }, [mcpServers, t])

  const closePopup = () => {
    setOpen(false)
    resolve({})
  }

  const onOk = async () => {
    setJsonSaving(true)

    try {
      if (!jsonConfig.trim()) {
        // Delete all existing servers
        for (const server of mcpServers) {
          await dataApiService.delete(`/mcp-servers/${server.id}`)
        }
        void refetch()
        window.toast.success(t('settings.mcp.jsonSaveSuccess'))
        setJsonError('')
        setJsonSaving(false)
        return
      }

      const parsedJson = parseJSON(jsonConfig)
      if (parsedJson === null) {
        throw new Error(t('settings.mcp.addServer.importFrom.invalid'))
      }

      const { data: parsedServers, error } = safeValidateMcpConfig(parsedJson)
      if (error) {
        throw new Error(formatZodError(error, t('settings.mcp.addServer.importFrom.invalid')))
      }

      const serversArray: MCPServer[] = []

      for (const [id, serverConfig] of Object.entries(parsedServers.mcpServers)) {
        const server: MCPServer = {
          id,
          isActive: false,
          name: serverConfig.name || id,
          ...serverConfig
        }

        serversArray.push(server)
      }

      // Delete existing servers not in the new config, update existing ones, create new ones
      const newServerIds = new Set(serversArray.map((s) => s.id))
      for (const server of mcpServers) {
        if (!newServerIds.has(server.id)) {
          await dataApiService.delete(`/mcp-servers/${server.id}`)
        }
      }
      const existingIds = new Set(mcpServers.map((s) => s.id))
      for (const server of serversArray) {
        if (existingIds.has(server.id)) {
          const { id, ...updates } = server
          await dataApiService.patch(`/mcp-servers/${id}`, { body: updates })
        } else {
          await dataApiService.post('/mcp-servers', { body: server })
        }
      }
      void refetch()

      window.toast.success(t('settings.mcp.jsonSaveSuccess'))
      setJsonError('')
      closePopup()
    } catch (error: unknown) {
      setJsonError(formatErrorMessage(error) || t('settings.mcp.jsonSaveError'))
      window.toast.error(t('settings.mcp.jsonSaveError'))
    } finally {
      setJsonSaving(false)
    }
  }

  EditMcpJsonPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePopup()}>
      <DialogContent className="max-w-[800px]" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.editJson')}</DialogTitle>
        </DialogHeader>
        <div className="mb-4 flex justify-between">
          <div className="w-full text-destructive text-sm">{jsonError ? <pre>{jsonError}</pre> : ''}</div>
        </div>
        {isLoading ? (
          <Spinner text={t('common.loading')} />
        ) : (
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
        )}
        <div className="text-muted-foreground text-sm">{t('settings.mcp.jsonModeHint')}</div>
        <DialogFooter>
          <Button variant="outline" onClick={closePopup}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onOk} loading={jsonSaving}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'EditMcpJsonPopup'

export default class EditMcpJsonPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
