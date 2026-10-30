import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmojiAvatar, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useSkillInstall } from '@renderer/hooks/useSkills'
import {
  generateAgentInstructions,
  recommendMarketplaceSkills,
  selectInstalledSkillIds
} from '@renderer/utils/resourceCatalog'
import type { Model } from '@shared/data/types/model'
import type { InstalledSkill } from '@shared/types/skill'

import type { ResourceCreateWizardValues } from './types'

const logger = loggerService.withContext('AutoCreateProgress')

type StepState = 'pending' | 'running' | 'done' | 'warning'
type StepId = 'prompt' | 'skills' | 'recommend' | 'create'

export type AutoCreateInput = Omit<ResourceCreateWizardValues, 'prompt' | 'skillIds' | 'knowledgeBaseIds'>

type AutoCreateProgressProps = {
  input: AutoCreateInput
  model?: Model
  onSubmit: (values: ResourceCreateWizardValues) => Promise<void> | void
  onBack: () => void
  onRunningChange: (running: boolean) => void
}

/**
 * Runs "Agent create": writes the system prompt, enables every installed skill (built-in tools stay
 * fully enabled), installs up to two marketplace skills chosen for the purpose, then creates the
 * Agent through the wizard's `onSubmit`. Model, search, and install failures fall back or are shown;
 * only a failed create stops the flow and offers a way back.
 */
export function AutoCreateProgress({ input, model, onSubmit, onBack, onRunningChange }: AutoCreateProgressProps) {
  const { t } = useTranslation()
  const [states, setStates] = useState<Record<StepId, StepState>>({
    prompt: 'running',
    skills: 'pending',
    recommend: 'pending',
    create: 'pending'
  })
  const [skillCount, setSkillCount] = useState<number | null>(null)
  const [recommendation, setRecommendation] = useState<{ installedNames: string[]; failed: boolean } | null>(null)
  const { install: installSkill } = useSkillInstall()
  const [createError, setCreateError] = useState<string | null>(null)
  const run = useEffectEvent(async (signal: AbortSignal) => {
    const mark = (id: StepId, state: StepState) => {
      if (!signal.aborted) setStates((current) => ({ ...current, [id]: state }))
    }

    onRunningChange(true)
    try {
      const { instructions, generated } = await generateAgentInstructions({
        name: input.name,
        purpose: input.description,
        model,
        signal
      })
      mark('prompt', generated ? 'done' : 'warning')

      mark('skills', 'running')
      let installedSkills: InstalledSkill[] = []
      try {
        installedSkills = await dataApiService.get('/skills')
      } catch (error) {
        logger.warn('Failed to list installed skills for Agent create', { error })
      }
      signal.throwIfAborted()
      const skillIds = selectInstalledSkillIds(installedSkills)
      setSkillCount(skillIds.length)
      mark('skills', 'done')

      mark('recommend', 'running')
      const recommended = await recommendMarketplaceSkills({
        name: input.name,
        purpose: input.description,
        model,
        installedNames: installedSkills.map((skill) => skill.name),
        signal
      })
      const installedNames: string[] = []
      let installFailed = false
      for (const candidate of recommended) {
        signal.throwIfAborted()
        const { skill } = await installSkill(candidate.installSource)
        if (skill) {
          skillIds.push(skill.id)
          installedNames.push(skill.name)
        } else {
          installFailed = true
        }
      }
      signal.throwIfAborted()
      setRecommendation({ installedNames, failed: installFailed })
      mark('recommend', installFailed && installedNames.length === 0 ? 'warning' : 'done')

      mark('create', 'running')
      await onSubmit({
        ...input,
        prompt: instructions,
        skillIds,
        knowledgeBaseIds: [],
        setupIncomplete: !generated
      })
      mark('create', 'done')
    } catch (error) {
      if (signal.aborted) return
      logger.error('Agent create failed', error as Error)
      mark('create', 'warning')
      setCreateError(
        error instanceof Error && error.message ? error.message : t('library.config.dialogs.create.submit_failed')
      )
    } finally {
      if (!signal.aborted) onRunningChange(false)
    }
  })
  const stopRunning = useEffectEvent(() => onRunningChange(false))

  // Runs once per mount; the dialog remounts this view for every new "Agent create".
  useEffect(() => {
    const controller = new AbortController()
    void run(controller.signal)
    return () => {
      controller.abort()
      stopRunning()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run`/`stopRunning` are effect events; the run is keyed to mount.
  }, [])

  const failed = createError !== null
  const steps: { id: StepId; title: string; detail: ReactNode }[] = [
    {
      id: 'prompt',
      title: t('library.config.dialogs.create.auto.step.prompt'),
      detail: t(
        states.prompt === 'warning'
          ? 'library.config.dialogs.create.auto.step.prompt_fallback'
          : 'library.config.dialogs.create.auto.step.prompt_detail'
      )
    },
    {
      id: 'skills',
      title: t('library.config.dialogs.create.auto.step.skills'),
      detail:
        skillCount === null
          ? t('library.config.dialogs.create.auto.step.skills_pending')
          : t('library.config.dialogs.create.auto.step.skills_detail', { count: skillCount })
    },
    {
      id: 'recommend',
      title: t('library.config.dialogs.create.auto.step.recommend'),
      detail: !recommendation
        ? states.recommend === 'running'
          ? t('library.config.dialogs.create.auto.step.recommend_searching')
          : null
        : recommendation.installedNames.length > 0
          ? t('library.config.dialogs.create.auto.step.recommend_installed', {
              names: recommendation.installedNames.join(', ')
            })
          : t(
              recommendation.failed
                ? 'library.config.dialogs.create.auto.step.recommend_failed'
                : 'library.config.dialogs.create.auto.step.recommend_none'
            )
    },
    {
      id: 'create',
      title: t('library.config.dialogs.create.auto.step.create'),
      detail: createError ?? null
    }
  ]

  return (
    <>
      <ScrollArea viewportProps={{ className: 'px-8 pt-6 pb-5' }} className="min-h-0 flex-1">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <EmojiAvatar size={56} fontSize={28} className="shrink-0 cursor-default rounded-[20%] hover:opacity-100">
              {input.avatar}
            </EmojiAvatar>
            <div className="min-w-0">
              <div className="truncate font-semibold text-base">{input.name}</div>
              <div className="text-muted-foreground text-sm">
                {t(
                  failed ? 'library.config.dialogs.create.submit_failed' : 'library.config.dialogs.create.auto.running'
                )}
              </div>
            </div>
          </div>

          <ol className="flex flex-col gap-1" aria-live="polite">
            {steps.map((step) => (
              <li key={step.id} className="flex gap-3 py-2">
                <StepIcon state={states[step.id]} />
                <div className="min-w-0 flex-1">
                  <div className={cn('text-sm', states[step.id] === 'pending' && 'text-muted-foreground')}>
                    {step.title}
                  </div>
                  {step.detail ? (
                    <div
                      className={cn(
                        'mt-0.5 text-xs',
                        step.id === 'create' && createError ? 'text-destructive' : 'text-muted-foreground'
                      )}>
                      {step.detail}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-end gap-2 border-border-subtle border-t px-6 py-3">
        <Button type="button" variant="outline" disabled={!failed} onClick={onBack}>
          {t('library.config.dialogs.create.back')}
        </Button>
      </div>
    </>
  )
}

function StepIcon({ state }: { state: StepState }) {
  return (
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
      {state === 'running' ? <Loader2 className="size-4 animate-spin text-foreground" /> : null}
      {state === 'done' ? <CheckCircle2 className="size-4 text-success" /> : null}
      {state === 'warning' ? <AlertCircle className="size-4 text-warning" /> : null}
      {state === 'pending' ? <Circle className="size-4 text-muted-foreground/40" /> : null}
    </span>
  )
}
