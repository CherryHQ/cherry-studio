import type { ConfirmDialog } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ClaimCliToolDialogController {
  claimDialogProps: ComponentProps<typeof ConfirmDialog>
  requestClaim: (tool: CodeCli) => void
}

/**
 * Confirmation for bringing an already-mise-installed CLI under Cherry
 * management. Not destructive: claiming reinstalls nothing and changes no
 * version — it only records ownership so update/remove become available.
 */
export function useClaimCliToolDialog({
  toolName,
  claim
}: {
  toolName: string
  claim: (tool: CodeCli) => Promise<boolean>
}): ClaimCliToolDialogController {
  const { t } = useTranslation()
  const [claimTarget, setClaimTarget] = useState<CodeCli | null>(null)

  return {
    claimDialogProps: {
      open: !!claimTarget,
      onOpenChange: (open) => !open && setClaimTarget(null),
      title: t('settings.dependencies.claimConfirmTitle'),
      description: t('settings.dependencies.claimConfirmMessage', { name: toolName }),
      confirmText: t('settings.dependencies.claimAction'),
      onConfirm: async () => {
        if (claimTarget) await claim(claimTarget)
      }
    },
    requestClaim: setClaimTarget
  }
}
