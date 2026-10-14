import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import type { ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'

import { McpServerConfigPreview } from './ProtocolInstallWarning'

interface McpProtocolInstallDialogProps {
  servers: ProtocolMcpServerInstall[]
  onClose: () => void
  onInstall: () => Promise<void>
}

const McpProtocolInstallDialog = ({ servers, onClose, onInstall }: McpProtocolInstallDialogProps) => {
  const { t } = useTranslation()
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await onInstall()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !installing && onClose()}>
      <DialogContent size="lg" closeOnOverlayClick={!installing} className="flex max-h-[70vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.protocolInstall.title')}</DialogTitle>
        </DialogHeader>

        <Scrollbar className="min-h-0 flex-1">
          <div className="flex flex-col gap-3">
            {servers.map((server, index) => {
              const serverType = server.type ?? ('baseUrl' in server ? 'sse' : 'stdio')

              return (
                <section
                  key={`${server.name}-${index}`}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{server.name}</span>
                    <Badge variant="outline" className="shrink-0">
                      {t(getMcpTypeLabelKey(serverType))}
                    </Badge>
                  </div>
                  <McpServerConfigPreview server={server} />
                </section>
              )
            })}
          </div>
        </Scrollbar>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={installing} onClick={onClose}>
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
