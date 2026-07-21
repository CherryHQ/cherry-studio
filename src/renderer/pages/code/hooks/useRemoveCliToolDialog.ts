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
  const [isRemoving, setIsRemoving] = useState(false)

  return {
    removeDialogProps: {
      open: !!removeTarget,
      onOpenChange: (open) => !open && setRemoveTarget(null),
      title: t('settings.dependencies.removeConfirmTitle'),
      description: t('settings.dependencies.removeConfirmMessage', { name: toolName }),
      destructive: true,
      confirmLoading: isRemoving,
      onConfirm: async () => {
        if (!removeTarget) return

        setIsRemoving(true)
        try {
          await remove(removeTarget)
        } finally {
          setIsRemoving(false)
        }
      }
    },
    requestRemove: setRemoveTarget
  }
}
