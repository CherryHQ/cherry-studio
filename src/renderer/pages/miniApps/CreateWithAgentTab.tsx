import { useNavigate } from '@tanstack/react-router'
import { Bot, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, DialogFooter, Field, FieldLabel, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { writeChatDraftCache } from '@renderer/components/composer/variants/chat/chatDraftCache'
import { useRawAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('CreateWithAgentTab')

/** The stage-1 Skill's identity (its SKILL.md frontmatter `name`). */
const CHERRY_MINIAPP_SKILL_NAME = 'cherry-miniapp'

/**
 * The "Create using Agent" tab (issue #21646, stage 3, AC7).
 *
 * The cherry-miniapp Skill binds DIRECTLY when installed: the tab offers the
 * requirement draft and starts a chat session with it. When the Skill is
 * missing the tab only GUIDES its import — it never installs anything itself,
 * so a repeated visit can never create a duplicate Skill.
 */
export const CreateWithAgentTab: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { reuseOrCreateTopic } = useRawAssistantTopicsSource()
  const [skillState, setSkillState] = useState<'loading' | 'installed' | 'missing'>('loading')
  const [draft, setDraft] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ipcApi.request('skill.list_catalog', {}).then(
      (entries) => {
        if (cancelled) return
        const installed = entries.some(
          (entry) => entry.name === CHERRY_MINIAPP_SKILL_NAME || entry.folderName === CHERRY_MINIAPP_SKILL_NAME
        )
        setSkillState(installed ? 'installed' : 'missing')
      },
      (error) => {
        logger.warn('Failed to list installed skills', { error })
        if (!cancelled) setSkillState('missing')
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const handleStart = async () => {
    setStarting(true)
    try {
      // Reuse the placeholder topic when one is empty: "Create using Agent"
      // twice must not pile up empty sessions.
      const result = await reuseOrCreateTopic(null)
      writeChatDraftCache(result.topic.id, {
        text: draft.trim(),
        tokens: [],
        files: [],
        knowledgeBaseIds: [],
        mentionedModelIds: [],
        modelMultiSelectMode: false
      })
      onClose()
      void navigate({ to: '/app/chat', search: { topicId: result.topic.id } })
    } catch (error) {
      logger.error('Failed to start a mini app authoring session', error as Error)
      toast.error(t('miniApp.add.agent_start_error'))
      setStarting(false)
    }
  }

  const openSkillsSettings = () => {
    onClose()
    void navigate({ to: '/settings/skills' })
  }

  if (skillState === 'missing') {
    return (
      <>
        <div className="flex flex-col gap-3 py-4">
          <Alert type="warning" message={t('miniApp.add.agent_skill_missing')} />
          <Button type="button" variant="outline" size="sm" className="gap-1.5 self-start" onClick={openSkillsSettings}>
            <FolderOpen size={12} />
            {t('miniApp.add.agent_open_skills')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <div className="grid gap-4 py-4">
        <Field>
          <FieldLabel htmlFor="miniapp-agent-draft">{t('miniApp.add.agent_draft_label')}</FieldLabel>
          <Textarea.Input
            id="miniapp-agent-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('miniApp.add.agent_draft_placeholder')}
            rows={4}
            disabled={skillState === 'loading'}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => void handleStart()}
          disabled={skillState !== 'installed' || !draft.trim() || starting}
          loading={starting}
          className="gap-1.5">
          <Bot size={12} />
          {t('miniApp.add.agent_start')}
        </Button>
      </DialogFooter>
    </>
  )
}

export default CreateWithAgentTab
