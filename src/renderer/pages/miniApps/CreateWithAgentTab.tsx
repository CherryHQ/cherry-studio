import { useNavigate } from '@tanstack/react-router'
import { Bot, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, DialogFooter, Field, FieldLabel, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { handOffAgentDraft } from '@renderer/services/agentDraftHandoff'
import { toast } from '@renderer/services/toast'
import type { SkillCatalogEntry } from '@shared/types/skill'

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
  const [skill, setSkill] = useState<SkillCatalogEntry | null | 'loading'>('loading')
  const [draft, setDraft] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ipcApi.request('skill.list_catalog', {}).then(
      (entries) => {
        if (cancelled) return
        const installed = entries.find(
          (entry) => entry.name === CHERRY_MINIAPP_SKILL_NAME || entry.folderName === CHERRY_MINIAPP_SKILL_NAME
        )
        setSkill(installed ?? null)
      },
      (error) => {
        logger.warn('Failed to list installed skills', { error })
        if (!cancelled) setSkill(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const handleStart = async () => {
    if (skill === 'loading' || skill === null) return
    setStarting(true)
    try {
      // AC7's direct binding: the installed Skill opens through the Skill-session
      // flow (its identity reaches session creation), never as an ordinary chat
      // topic. The requirement draft rides the agent-draft handoff so the prepared
      // composer's skill token carries it.
      const { sessionId } = await ipcApi.request('ai.agent.skill_session.create', { skillId: skill.id })
      const requirement = draft.trim()
      if (requirement) {
        handOffAgentDraft(sessionId, { text: requirement, tokens: [], files: [], knowledgeBaseIds: [] })
      }
      onClose()
      void navigate({ to: '/app/agents', search: { intent: 'skill', sessionId, skillId: skill.id } })
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

  if (skill === null) {
    // AC12: without the authoring tools the host gets generation and packaging
    // only — the prompt says so plainly and never claims preview, real-runtime
    // testing or installation.
    return (
      <>
        <div className="flex flex-col gap-3 py-4">
          <Alert
            type="warning"
            message={t('miniApp.add.agent_skill_missing')}
            description={t('miniApp.add.agent_skill_missing_scope')}
          />
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
            disabled={skill === 'loading'}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => void handleStart()}
          disabled={skill === 'loading' || skill === null || !draft.trim() || starting}
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
