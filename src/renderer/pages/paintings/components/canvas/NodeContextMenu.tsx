import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { Copy, Download, Trash2 } from 'lucide-react'
import { type FC, type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../../model/types/paintingData'
import { useCanvasActions } from './canvasActions'

/**
 * Right-click menu for a card: local ops only (no model call) — download the
 * image, copy the prompt, delete the card. Routed through the project's command
 * menu system (`CommandContextMenu`) so it honours native-vs-cherry
 * presentation and the menu preference, like every other context menu.
 */
const NodeContextMenu: FC<{ painting: PaintingData; children: ReactNode }> = ({ painting, children }) => {
  const { t } = useTranslation()
  const { onDownload, onCopyPrompt, onDelete } = useCanvasActions()

  const items = useMemo<CommandContextMenuExtraItem[]>(
    () => [
      {
        type: 'item',
        id: 'painting.canvas.download',
        label: t('paintings.canvas.menu.download'),
        icon: <Download className="size-4" />,
        enabled: painting.files.length > 0,
        onSelect: () => onDownload(painting)
      },
      {
        type: 'item',
        id: 'painting.canvas.copy_prompt',
        label: t('paintings.canvas.menu.copy_prompt'),
        icon: <Copy className="size-4" />,
        enabled: Boolean(painting.prompt),
        onSelect: () => onCopyPrompt(painting)
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'painting.canvas.delete',
        label: t('common.delete'),
        icon: <Trash2 className="size-4" />,
        destructive: true,
        onSelect: () => onDelete(painting)
      }
    ],
    [painting, onDownload, onCopyPrompt, onDelete, t]
  )

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items}>
      {children}
    </CommandContextMenu>
  )
}

export default NodeContextMenu
