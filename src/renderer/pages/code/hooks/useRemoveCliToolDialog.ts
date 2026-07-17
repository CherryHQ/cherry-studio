import type { ConfirmDialog } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RemoveCliToolDialogController {
  removeDialogProps: ComponentProps<typeof ConfirmDialog>
  requestRemove: (tool: CodeCli) => void
}

export function useRemoveCliToolDialog({
  toolName,
  remove
}: {
  toolName: string
  remove: (tool: CodeCli) => Promise<void>
}): RemoveCliToolDialogController {
  const { t } = useTranslation()
  const [removeTarget, setRemoveTarget] = useState<CodeCli | null>(null)

  return {
    removeDialogProps: {
      open: !!removeTarget,
      onOpenChange: (open) => !open && setRemoveTarget(null),
      title: t('settings.dependencies.uninstallConfirmTitle'),
      description: t('settings.dependencies.uninstallConfirmMessage', { name: toolName }),
      destructive: true,
      onConfirm: async () => {
        if (removeTarget) await remove(removeTarget)
      }
    },
    requestRemove: setRemoveTarget
  }
}
