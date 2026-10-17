import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox, ConfirmDialog, Label } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'

const IRREVERSIBLE_DESCRIPTION_KEY = 'settings.data.trash.permanent_delete.confirm_content'

export interface DeleteConversationOwnerConfirmDialogProps {
  type: 'agent' | 'assistant'
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (deleteChildren: boolean) => void | Promise<void>
  mode?: 'archive' | 'permanent'
  name?: string
}

// A resolved confirm must be allowed to close. Dismissal and a second submit stay
// blocked while that confirm is in flight, before `pending` re-renders.
function useDeletionConfirmGuard(
  open: boolean,
  pending: boolean,
  onOpenChange: (open: boolean) => void,
  onReset?: () => void
) {
  const submittingRef = useRef(false)
  const confirmedCloseRef = useRef(false)

  const runConfirm = async (action: () => void | Promise<void>): Promise<false | void> => {
    if (submittingRef.current || pending) return false
    submittingRef.current = true
    try {
      await action()
      confirmedCloseRef.current = true
    } catch {
      // ConfirmDialog keeps itself open when confirm returns false, so a later
      // Cancel or Escape must still reach onOpenChange.
      submittingRef.current = false
      return false
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && !confirmedCloseRef.current && (pending || submittingRef.current)) return

    if (!next || !open) onReset?.()
    if (!next) {
      submittingRef.current = false
      confirmedCloseRef.current = false
    }
    onOpenChange(next)
  }

  return { runConfirm, handleOpenChange }
}

export function DeleteConversationOwnerConfirmDialog({
  type,
  open,
  pending,
  onOpenChange,
  onConfirm,
  mode = 'archive',
  name
}: DeleteConversationOwnerConfirmDialogProps) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [deleteChildren, setDeleteChildren] = useState(false)
  const { runConfirm, handleOpenChange } = useDeletionConfirmGuard(open, pending, onOpenChange, () =>
    setDeleteChildren(false)
  )
  const permanent = mode === 'permanent'
  const displayName = name?.trim() || t('common.unnamed')
  const checkboxLabel = t(
    permanent
      ? type === 'agent'
        ? 'conversation_owner.delete_permanently.related_sessions'
        : 'conversation_owner.delete_permanently.related_topics'
      : type === 'agent'
        ? 'conversation_owner.archive.related_sessions'
        : 'conversation_owner.archive.related_topics'
  )

  return (
    <ConfirmDialog
      open={open}
      title={permanent ? t('conversation.delete_permanently.title', { name: displayName }) : t('common.archive')}
      description={permanent ? t(IRREVERSIBLE_DESCRIPTION_KEY) : undefined}
      confirmText={permanent ? t('common.delete_permanently') : t('common.archive')}
      cancelText={t('common.cancel')}
      destructive={permanent}
      cancelDisabled={pending}
      confirmLoading={pending}
      confirmDisabled={pending}
      onOpenChange={handleOpenChange}
      onConfirm={() => runConfirm(() => onConfirm(deleteChildren))}
      content={
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id={checkboxId}
              checked={deleteChildren}
              disabled={pending}
              onCheckedChange={(checked) => setDeleteChildren(checked === true)}
            />
            <Label htmlFor={checkboxId}>{checkboxLabel}</Label>
          </div>
        </div>
      }
    />
  )
}

export interface PermanentConversationDeleteDialogProps {
  name: string
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function PermanentConversationDeleteDialog({
  name,
  open,
  pending,
  onOpenChange,
  onConfirm
}: PermanentConversationDeleteDialogProps) {
  const { t } = useTranslation()
  const { runConfirm, handleOpenChange } = useDeletionConfirmGuard(open, pending, onOpenChange)
  const displayName = name.trim() || t('common.unnamed')

  return (
    <ConfirmDialog
      open={open}
      title={t('conversation.delete_permanently.title', { name: displayName })}
      description={t(IRREVERSIBLE_DESCRIPTION_KEY)}
      confirmText={t('common.delete_permanently')}
      cancelText={t('common.cancel')}
      destructive
      cancelDisabled={pending}
      confirmLoading={pending}
      confirmDisabled={pending}
      onOpenChange={handleOpenChange}
      onConfirm={() => runConfirm(() => onConfirm())}
    />
  )
}

export interface DeleteConversationOwnerPopupParams {
  type: 'agent' | 'assistant'
  action: (deleteChildren: boolean) => void | Promise<void>
}

function PopupContainer({
  open,
  resolve,
  type,
  action
}: DeleteConversationOwnerPopupParams & PopupInjectedProps<boolean>) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending) {
      resolve(false)
    }
  }

  const handleConfirm = async (deleteChildren: boolean) => {
    setPending(true)
    try {
      await action(deleteChildren)
    } catch (error) {
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      setPending(false)
      throw error
    }
    resolve(true)
  }

  return (
    <DeleteConversationOwnerConfirmDialog
      type={type}
      open={open}
      pending={pending}
      onOpenChange={handleOpenChange}
      onConfirm={handleConfirm}
    />
  )
}

export const deleteConversationOwnerPopup = createPopup<DeleteConversationOwnerPopupParams, boolean>(PopupContainer, {
  dismissResult: false
})

export type PermanentDeletePopupParams =
  | {
      kind: 'conversation'
      name: string
      action: () => void | Promise<void>
    }
  | {
      kind: 'owner'
      type: 'agent' | 'assistant'
      name: string
      action: (deleteChildren: boolean) => void | Promise<void>
    }

function PermanentDeletePopupContainer(props: PermanentDeletePopupParams & PopupInjectedProps<boolean>) {
  const { t } = useTranslation()
  const { open, resolve } = props
  const [pending, setPending] = useState(false)
  const submittingRef = useRef(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && !pending && !submittingRef.current) {
      resolve(false)
    }
  }

  const runAction = async (action: () => Promise<void>) => {
    if (submittingRef.current) {
      throw new Error('Permanent delete confirmation is already submitting')
    }
    submittingRef.current = true
    setPending(true)
    try {
      await action()
    } catch (error) {
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      submittingRef.current = false
      setPending(false)
      throw error
    }
    resolve(true)
  }

  if (props.kind === 'conversation') {
    return (
      <PermanentConversationDeleteDialog
        name={props.name}
        open={open}
        pending={pending}
        onOpenChange={handleOpenChange}
        onConfirm={() => runAction(async () => props.action())}
      />
    )
  }

  return (
    <DeleteConversationOwnerConfirmDialog
      mode="permanent"
      type={props.type}
      name={props.name}
      open={open}
      pending={pending}
      onOpenChange={handleOpenChange}
      onConfirm={(deleteChildren) => runAction(async () => props.action(deleteChildren))}
    />
  )
}

export const permanentDeletePopup = createPopup<PermanentDeletePopupParams, boolean>(PermanentDeletePopupContainer, {
  dismissResult: false
})
