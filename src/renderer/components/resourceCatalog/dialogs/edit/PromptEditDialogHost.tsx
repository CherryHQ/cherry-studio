import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePromptMutations, usePromptMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { Prompt, PromptBindingTarget, PromptVisibility } from '@shared/data/types/prompt'

import PromptEditDialog from './PromptEditDialog'

type PromptFormValue = { title: string; content: string; visibility: PromptVisibility }
type PendingVisibilityChange = { payload: PromptFormValue; bindings: PromptBindingTarget[] }

export function PromptEditDialogHost({
  open,
  prompt,
  onClose
}: {
  open: boolean
  prompt: Prompt | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [pendingVisibilityChange, setPendingVisibilityChange] = useState<PendingVisibilityChange | null>(null)
  const { createPrompt } = usePromptMutations()
  const { updatePrompt } = usePromptMutationsById(prompt?.id ?? '')
  const { refetch: refetchBindings } = useQuery('/prompts/:id/bindings', {
    enabled: open && prompt?.visibility === 'restricted',
    params: { id: prompt?.id ?? '' },
    swrOptions: { keepPreviousData: false }
  })

  const handleSave = useCallback(
    async (payload: PromptFormValue) => {
      setSaving(true)
      try {
        if (prompt) {
          if (prompt.visibility === 'restricted' && payload.visibility === 'global') {
            const bindings = await refetchBindings()
            if (!Array.isArray(bindings)) throw new Error('Unable to load prompt bindings')
            if (bindings.length > 0) {
              setPendingVisibilityChange({ payload, bindings })
              return
            }
            await updatePrompt({ ...payload, expectedBindings: bindings })
          } else {
            await updatePrompt(payload)
          }
        } else {
          await createPrompt(payload)
        }
        onClose()
      } catch (error) {
        if (
          error instanceof DataApiError &&
          error.code === ErrorCode.CONCURRENT_MODIFICATION &&
          prompt?.visibility === 'restricted' &&
          payload.visibility === 'global'
        ) {
          const bindings = await refetchBindings()
          if (Array.isArray(bindings)) {
            setPendingVisibilityChange({ payload, bindings })
            return
          }
        }
        toast.error(
          formatErrorMessageWithPrefix(
            error,
            t(prompt ? 'settings.prompts.errors.updateFailed' : 'settings.prompts.errors.createFailed')
          )
        )
        throw error
      } finally {
        setSaving(false)
      }
    },
    [createPrompt, onClose, prompt, refetchBindings, t, updatePrompt]
  )

  const handleConfirmVisibilityChange = useCallback(async () => {
    if (!pendingVisibilityChange) return

    setSaving(true)
    try {
      await updatePrompt({
        ...pendingVisibilityChange.payload,
        expectedBindings: pendingVisibilityChange.bindings
      })
      setPendingVisibilityChange(null)
      onClose()
    } catch (error) {
      if (error instanceof DataApiError && error.code === ErrorCode.CONCURRENT_MODIFICATION) {
        const bindings = await refetchBindings()
        if (Array.isArray(bindings)) {
          setPendingVisibilityChange((current) => (current ? { ...current, bindings } : current))
        }
      }
      toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.updateFailed')))
      throw error
    } finally {
      setSaving(false)
    }
  }, [onClose, pendingVisibilityChange, refetchBindings, t, updatePrompt])

  return (
    <>
      <PromptEditDialog
        open={open}
        prompt={prompt}
        saving={saving}
        onSave={handleSave}
        onCancel={() => {
          if (!saving) onClose()
        }}
      />
      <ConfirmDialog
        open={pendingVisibilityChange !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingVisibilityChange(null)
        }}
        title={t('settings.prompts.visibility.makeGlobalConfirmTitle')}
        description={t('settings.prompts.visibility.makeGlobalConfirmDescription', {
          count: pendingVisibilityChange?.bindings.length ?? 0
        })}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={saving}
        onConfirm={handleConfirmVisibilityChange}
      />
    </>
  )
}
