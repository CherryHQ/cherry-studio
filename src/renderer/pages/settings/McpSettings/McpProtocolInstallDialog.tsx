import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Scrollbar
} from '@cherrystudio/ui'
import { getMcpTypeLabelKey } from '@renderer/i18n/label'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getCommandPreview } from './utils'

interface McpProtocolInstallDialogProps {
  open: boolean
  servers: CreateMcpServerDto[]
  onOpenChange: (open: boolean) => void
  onInstall: () => Promise<void>
}

const McpProtocolInstallDialog = ({ open, servers, onOpenChange, onInstall }: McpProtocolInstallDialogProps) => {
  const { t } = useTranslation()
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    if (installing) return

    setInstalling(true)
    try {
      await onInstall()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !installing && onOpenChange(next)}>
      <DialogContent size="lg" closeOnOverlayClick={!installing} className="flex max-h-[70vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.install')} MCP</DialogTitle>
        </DialogHeader>

        <Scrollbar className="min-h-0 flex-1 pr-3">
          <div className="flex flex-col gap-3">
            {servers.map((server, index) => {
              const serverType = server.type ?? (server.baseUrl ? 'sse' : 'stdio')
              const connectionPreview = server.baseUrl ?? getCommandPreview(server)
              const connectionLabel = server.baseUrl ? t('settings.mcp.url') : t('settings.mcp.command')

              return (
                <section
                  key={`${server.name}-${index}`}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-medium text-sm">{server.name}</span>
                    <Badge variant="outline" className="shrink-0">
                      {t(getMcpTypeLabelKey(serverType))}
                    </Badge>
                  </div>
                  {connectionPreview && (
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-xs">{connectionLabel}</span>
                      <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-sm">
                        {connectionPreview}
                      </pre>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </Scrollbar>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={installing} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="emphasis"
            disabled={installing}
            loading={installing}
            onClick={() => void handleInstall()}>
            {t('settings.mcp.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default McpProtocolInstallDialog
