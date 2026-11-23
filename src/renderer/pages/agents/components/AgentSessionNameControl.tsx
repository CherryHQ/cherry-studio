import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { useUpdateSession } from '@renderer/hooks/agent/useSession'
import { SessionNameEntitySchema } from '@shared/data/api/schemas/agentSessions'

interface AgentSessionNameControlProps {
  sessionId: string
  sessionName: string
  onCloseAutoFocus?: () => void
}

export function AgentSessionNameControl({ sessionId, sessionName, onCloseAutoFocus }: AgentSessionNameControlProps) {
  const { t } = useTranslation()
  const { updateSession } = useUpdateSession()
  const interactedOutside = useRef(false)
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId
  // Bumped on every session change and every new save. A completion only
  // applies while its generation is current, so a stale save finishing after
  // an A→B→A navigation cannot close the editor the user just opened.
  const submitGeneration = useRef(0)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(sessionName)
  const [draftSessionId, setDraftSessionId] = useState(sessionId)
  if (draftSessionId !== sessionId) {
    submitGeneration.current += 1
    setSaving(false)
    setDraftSessionId(sessionId)
    setDraft(sessionName)
    setOpen(false)
  }

  const name = draft.trim()
  const validName = Boolean(name) && SessionNameEntitySchema.safeParse(name).success
  const submit = async () => {
    if (saving || !validName) return
    if (name === sessionName) {
      setOpen(false)
      return
    }
    // A new save supersedes any still-pending one.
    const generation = ++submitGeneration.current
    setSaving(true)
    try {
      const updated = await updateSession(
        { id: sessionId, name, isNameManuallyEdited: true },
        { showSuccessToast: false }
      )
      if (generation === submitGeneration.current && currentSessionId.current === sessionId && updated) setOpen(false)
    } finally {
      if (generation === submitGeneration.current && currentSessionId.current === sessionId) setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          interactedOutside.current = false
          setDraft(sessionName)
        }
        setOpen(next)
      }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title={t('common.rename')} className="min-w-0 shrink text-xs">
          <span className="max-w-40 truncate">{sessionName || t('message.tools.sessionCreate.untitled')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        onInteractOutside={() => {
          interactedOutside.current = true
        }}
        onCloseAutoFocus={(event) => {
          if (!interactedOutside.current && onCloseAutoFocus) {
            event.preventDefault()
            onCloseAutoFocus()
          }
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}>
          <Input
            aria-label={t('agent.session.edit.title')}
            autoFocus
            maxLength={255}
            disabled={saving}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={saving || !validName}>
            {t('common.save')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
