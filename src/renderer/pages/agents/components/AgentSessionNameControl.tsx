import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'

interface AgentSessionNameControlProps {
  sessionId: string
  sessionName: string
  onCloseAutoFocus?: () => void
}

export function AgentSessionNameControl({ sessionId, sessionName, onCloseAutoFocus }: AgentSessionNameControlProps) {
  const { t } = useTranslation()
  const { updateSession } = useUpdateSession()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(sessionName)
  const [draftSessionId, setDraftSessionId] = useState(sessionId)
  if (draftSessionId !== sessionId) {
    setDraftSessionId(sessionId)
    setDraft(sessionName)
    setOpen(false)
  }

  const submit = async () => {
    const name = draft.trim()
    setOpen(false)
    if (!name || name === sessionName) return
    await updateSession({ id: sessionId, name, isNameManuallyEdited: true }, { showSuccessToast: false })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(sessionName)
        setOpen(next)
      }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title={t('common.rename')} className="min-w-0 shrink text-xs">
          <span className="max-w-40 truncate">{sessionName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(event) => event.preventDefault()}>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}>
          <Input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            {t('common.save')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
