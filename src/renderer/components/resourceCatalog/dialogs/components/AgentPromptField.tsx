import { ChevronLeft, ChevronRight, RotateCcw, SquarePen } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount } from 'tokenx'

import { Button, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptEditorField, { PromptEditorIconButton } from '@renderer/components/PromptEditorField'
import { useDataChange } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { containsSupportedVariables } from '@renderer/utils/prompt'
import { RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { type AgentLanguageMode, normalizeAgentLanguageInput } from '@shared/ai/agentForm'
import {
  AGENT_INSTRUCTIONS_SLOT,
  type AgentPromptOverrides,
  isEditablePromptSection
} from '@shared/ai/agentPromptSections'
import { AGENT_PROMPT } from '@shared/ai/prompts'
import type { UniqueModelId } from '@shared/data/types/model'
import type {
  AgentPromptBlockPreview,
  AgentPromptInstructionsDraft,
  AgentSystemPromptDraft,
  AgentSystemPromptPreview
} from '@shared/ipc/schemas/agent'

import { PromptVariablesPopover } from './EditDialogShared'
import { PromptPolishActions, usePromptPolish } from './PromptPolishActions'

const logger = loggerService.withContext('AgentPromptField')
const PREVIEW_DEBOUNCE_MS = 300
const fixedTextClassName = 'whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground leading-5'

const BLOCK_TITLES: Record<string, string> = {
  cwd: 'agent.toolPermission.workingDirectory',
  agent_identity: 'library.config.agent.prompt.block.agent_identity',
  project_context: 'library.config.agent.prompt.block.project_context',
  skills: 'library.config.agent.prompt.block.skills',
  workspace_system: 'library.config.agent.prompt.block.workspace_system',
  instruction_precedence: 'library.config.agent.prompt.block.instruction_precedence',
  report_artifacts: 'library.config.agent.prompt.block.report_artifacts',
  config_tools: 'library.config.agent.prompt.block.config_tools',
  instructions: 'library.config.agent.prompt.block.instructions',
  bootstrap: 'library.config.agent.prompt.block.bootstrap',
  memories: 'library.config.agent.prompt.block.memories',
  citations: 'library.config.agent.prompt.block.citations',
  language: 'library.config.agent.prompt.block.language'
}
/** What keeps each live or setting block current. */
const BLOCK_CAPTIONS: Record<string, string> = {
  agent_identity: 'library.config.agent.prompt.caption.agent_identity',
  project_context: 'library.config.agent.prompt.caption.project_context',
  skills: 'library.config.agent.prompt.caption.skills',
  workspace_system: 'library.config.agent.prompt.caption.workspace_system',
  language: 'library.config.agent.prompt.caption.language'
}

/** Everything besides the instructions that changes the assembled prompt. */
export type AgentPromptDraft = Omit<AgentSystemPromptDraft, 'instructions' | 'language'> & {
  languageMode: AgentLanguageMode
  languageCustom: string
}

type AgentPromptFieldProps = {
  value: string
  onChange: (value: string) => void
  /** The Agent's name, which Generate writes a blank Agent prompt from. */
  name: string
  draft: AgentPromptDraft
  portalContainer: HTMLElement | null
  modelId: UniqueModelId | null
  visible?: boolean
  onNativePromptEnabledChange?: (enabled: boolean) => void
  /** Given only where the Agent exists: guidance blocks are then editable and saved here. */
  overrides?: AgentPromptOverrides
  onOverridesChange?: (next: AgentPromptOverrides) => void
  /** The block open on its own page; given with `onSectionChange` when a dialog header shows it. */
  section?: string | null
  onSectionChange?: (key: string | null) => void
  /** Opens the Memory page, where the files the identity block is built from are edited. */
  onEditIdentity?: () => void
  /** Shown above the list only; a page opened from it carries its own title. */
  heading?: ReactNode
}

/** Mirrors how the edit form saves `configuration.language`; an invalid custom label keeps the inherited one. */
function draftLanguage({ languageMode, languageCustom }: AgentPromptDraft): string | null | undefined {
  if (languageMode === 'off') return null
  if (languageMode === 'custom') return normalizeAgentLanguageInput(languageCustom) ?? undefined
  return undefined
}

function useAgentPromptPreview(draft: AgentPromptDraft, instructions: string, listShown: boolean, visible: boolean) {
  const [preview, setPreview] = useState<AgentSystemPromptPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const instructionsRef = useRef(instructions)
  useEffect(() => {
    instructionsRef.current = instructions
  })
  const { agentId, sessionId, agentType, claudeCodeNativePromptEnabled, skillIds, disabledTools, knowledgeBaseIds } =
    draft
  const language = draftLanguage(draft)
  const request: Omit<AgentSystemPromptDraft, 'instructions'> = {
    agentId,
    sessionId,
    agentType,
    claudeCodeNativePromptEnabled,
    ...(language === undefined ? {} : { language }),
    skillIds,
    disabledTools,
    knowledgeBaseIds
  }
  // The assembly only depends on whether instructions exist; their text sits in the editable slot.
  const requestKey = JSON.stringify([request, Boolean(instructions.trim())])

  // Re-read on each switch between the list and a page: a page may save files the prompt is built from.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const [nextRequest] = JSON.parse(requestKey) as [Omit<AgentSystemPromptDraft, 'instructions'>]
    const timer = setTimeout(() => {
      ipcApi
        .request('agent.system_prompt.preview', { ...nextRequest, instructions: instructionsRef.current })
        .then((next) => {
          if (cancelled) return
          setPreview(next)
          setFailed(false)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          logger.error('Failed to assemble the Agent system prompt preview', error as Error)
          setFailed(true)
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [requestKey, attempt, listShown, visible])

  return { preview, failed, retry: () => setAttempt((count) => count + 1) }
}

function useResolvedAgentInstructions(
  { agentId, sessionId, instructions, modelId }: AgentPromptInstructionsDraft,
  visible: boolean
) {
  const [revision, setRevision] = useState(0)
  const [resolved, setResolved] = useState<{ request: AgentPromptInstructionsDraft; revision: number; text: string }>()
  const request = useMemo(
    () => (visible && containsSupportedVariables(instructions) ? { agentId, sessionId, instructions, modelId } : null),
    [agentId, sessionId, instructions, modelId, visible]
  )
  useDataChange(
    request && sessionId && instructions.includes('{{model_name}}') ? '/agent-sessions/:sessionId' : [],
    (effects) => {
      if (sessionId && effects.some((effect) => !effect.entityIds || effect.entityIds.includes(sessionId))) {
        setRevision((previous) => previous + 1)
      }
    }
  )

  useEffect(() => {
    if (!request) return
    let cancelled = false
    const timer = setTimeout(() => {
      void ipcApi.request('agent.system_prompt.resolve_instructions', request).then(
        (text) => {
          if (!cancelled) setResolved({ request, revision, text })
        },
        (error: unknown) => {
          if (!cancelled) logger.warn('Failed to resolve Agent prompt instructions', error as Error)
        }
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request, revision])

  if (!request) return instructions
  return resolved?.request === request && resolved.revision === revision ? resolved.text : undefined
}

/** The title key of a prompt block, for a page header that shows one block. */
export function getPromptBlockTitleKey(key: string): string | undefined {
  return BLOCK_TITLES[key]
}

/**
 * An Agent System Prompt: the Agent's own prompt to edit, then the blocks the runtime adds, each
 * opened on its own page. The page is controlled where a dialog header shows it, else local.
 */
export function AgentPromptField({
  value,
  onChange,
  name,
  draft,
  portalContainer,
  modelId,
  visible = true,
  onNativePromptEnabledChange,
  overrides,
  onOverridesChange,
  section: controlledSection,
  onSectionChange,
  onEditIdentity,
  heading
}: AgentPromptFieldProps) {
  const { t } = useTranslation()
  const [localSection, setLocalSection] = useState<string | null>(null)
  const section = onSectionChange ? (controlledSection ?? null) : localSection
  const { preview, failed, retry } = useAgentPromptPreview(draft, value, section === null, visible)
  const setSection = onSectionChange ?? setLocalSection
  const instructions = value || preview?.builtinInstructions || ''
  const resolvedInstructions = useResolvedAgentInstructions(
    { agentId: draft.agentId, sessionId: draft.sessionId, instructions, modelId },
    visible
  )
  const { actions: polishActions } = usePromptPolish({
    value: instructions,
    fallbackSource: name,
    emptyValueSystemPrompt: AGENT_PROMPT,
    existingValueSystemPrompt: RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT,
    onChange
  })
  if (!visible) return null

  const nativePromptLabel = t('library.config.agent.prompt.claude_code_native')
  const overrideOf = (key: string) => (isEditablePromptSection(key) ? overrides?.[key] : undefined)
  const tokens =
    preview && resolvedInstructions !== undefined
      ? estimateTokenCount(
          preview.blocks
            .map((block) =>
              block.kind === 'instructions'
                ? block.text.replace(AGENT_INSTRUCTIONS_SLOT, () => resolvedInstructions)
                : (overrideOf(block.key) ?? block.text)
            )
            .join('\n\n')
        )
      : null

  const setOverride = (key: string, next: string | undefined) => {
    if (!overrides || !onOverridesChange || !isEditablePromptSection(key)) return
    const rest = { ...overrides }
    delete rest[key]
    onOverridesChange(next === undefined ? rest : { ...rest, [key]: next })
  }

  const backButton = (title: string) =>
    onSectionChange ? null : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 self-start px-1.5 text-xs"
        onClick={() => setSection(null)}>
        <ChevronLeft className="size-3.5" />
        {title}
      </Button>
    )

  if (section === 'instructions') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <InstructionsEditor
          label={
            backButton(t(BLOCK_TITLES.instructions)) ?? (
              <span className="truncate text-muted-foreground text-xs">
                {t('library.config.agent.prompt.instructions_caption')}
              </span>
            )
          }
          value={instructions}
          builtin={preview?.builtinInstructions}
          overridden={Boolean(value)}
          resolvedInstructions={resolvedInstructions ?? instructions}
          polishActions={polishActions}
          portalContainer={portalContainer}
          onChange={onChange}
          fill={Boolean(onSectionChange)}
        />
      </div>
    )
  }

  const opened = preview?.blocks.find((block) => block.key === section && block.kind !== 'instructions')
  if (opened) {
    const editable = Boolean(overrides) && isEditablePromptSection(opened.key)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {backButton(t(BLOCK_TITLES[opened.key] ?? '') || opened.key)}
        {editable ? (
          <BlockEditor
            block={opened}
            override={overrideOf(opened.key)}
            onChange={(next) => setOverride(opened.key, next === opened.text ? undefined : next)}
            onRestore={() => setOverride(opened.key, undefined)}
          />
        ) : (
          <BlockViewer
            block={opened}
            action={
              opened.key === 'agent_identity' && onEditIdentity ? (
                <PromptEditorIconButton
                  label={t('library.config.agent.prompt.edit_in_memory')}
                  icon={<SquarePen className="size-3" />}
                  onClick={onEditIdentity}
                  showLabel
                />
              ) : undefined
            }
          />
        )}
      </div>
    )
  }

  const others = preview?.blocks.filter((block) => block.kind !== 'instructions') ?? []
  const instructionsTitle = t(BLOCK_TITLES.instructions)
  const firstLine = instructions
    .split('\n')
    .find((line) => line.trim())
    ?.trim()

  return (
    <div className="flex flex-col gap-5">
      {heading}
      {draft.agentType === 'claude-code' && onNativePromptEnabledChange ? (
        <div className="flex items-center justify-between gap-3 px-1 text-sm">
          <span>{nativePromptLabel}</span>
          <Switch
            aria-label={nativePromptLabel}
            checked={draft.claudeCodeNativePromptEnabled !== false}
            onCheckedChange={onNativePromptEnabledChange}
          />
        </div>
      ) : null}
      <div className="flex flex-col rounded-xl border border-border-subtle p-1">
        <Button
          type="button"
          variant="ghost"
          aria-label={instructionsTitle}
          onClick={() => setSection('instructions')}
          className="h-9 justify-between gap-3 rounded-lg px-2.5 font-normal text-sm">
          <span className="shrink-0 text-foreground">{instructionsTitle}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            <span className="truncate">{firstLine}</span>
            <ChevronRight className="size-3.5 shrink-0" />
          </span>
        </Button>
      </div>
      {preview ? (
        <section aria-label={t('library.config.agent.prompt.runtime_sections')} className="flex flex-col gap-1.5">
          <div className="px-1 text-muted-foreground text-xs">{t('library.config.agent.prompt.runtime_sections')}</div>
          <div className="flex flex-col rounded-xl border border-border-subtle p-1">
            {others.map((block) => {
              const label = BLOCK_TITLES[block.key] ? t(BLOCK_TITLES[block.key]) : block.key
              // Only what the user needs to notice: their own edits, and blocks they cannot change here.
              const note =
                overrideOf(block.key) !== undefined
                  ? t('library.config.agent.prompt.edited')
                  : (overrides && isEditablePromptSection(block.key)) ||
                      (block.key === 'agent_identity' && onEditIdentity)
                    ? undefined
                    : t('library.config.agent.prompt.read_only')
              return (
                <Button
                  key={block.key}
                  type="button"
                  variant="ghost"
                  aria-label={note ? `${label}: ${note}` : label}
                  onClick={() => setSection(block.key)}
                  className="h-9 justify-between gap-3 rounded-lg px-2.5 font-normal text-sm">
                  <span className="truncate text-foreground">{label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                    {note}
                    <ChevronRight className="size-3.5" />
                  </span>
                </Button>
              )
            })}
          </div>
        </section>
      ) : (
        <p role="status" className="text-muted-foreground text-xs">
          {failed ? t('library.config.agent.prompt.load_failed') : t('library.config.agent.prompt.loading')}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-foreground-tertiary text-xs">
        {tokens !== null ? (
          <span className="tabular-nums">
            {t('library.config.agent.prompt.tokens', { tokens: tokens.toLocaleString() })}
          </span>
        ) : (
          <span />
        )}
        {failed ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Live data or a setting's output, shown as sent. */
function BlockViewer({ block, action }: { block: AgentPromptBlockPreview; action?: ReactNode }) {
  const { t } = useTranslation()
  const caption = BLOCK_CAPTIONS[block.key]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {caption || action ? (
        <div className="flex min-h-6 items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{caption ? t(caption) : null}</p>
          {action}
        </div>
      ) : null}
      <pre className={`${fixedTextClassName} min-h-0 flex-1 overflow-y-auto rounded-xl bg-muted/40 px-3 py-2.5`}>
        {block.text.trim()}
      </pre>
    </div>
  )
}

/** Resets a page to where it started; always in the same corner, enabled once there is something to undo. */
function RestoreButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onClick}
        className="flex size-6 min-h-0 items-center justify-center rounded-md border border-border-subtle p-0 text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0 aria-disabled:pointer-events-none aria-disabled:opacity-40">
        <RotateCcw className="size-3" />
      </Button>
    </Tooltip>
  )
}

/** A block the Agent may rewrite; an edited live block stops following the data it was generated from. */
function BlockEditor({
  block,
  override,
  onChange,
  onRestore
}: {
  block: AgentPromptBlockPreview
  override: string | undefined
  onChange: (next: string) => void
  onRestore: () => void
}) {
  const { t } = useTranslation()
  const text = override ?? block.text
  const label = BLOCK_TITLES[block.key] ? t(BLOCK_TITLES[block.key]) : block.key
  const status =
    override === undefined
      ? t(BLOCK_CAPTIONS[block.key] ?? 'library.config.agent.prompt.summary.generated')
      : t(
          block.kind === 'guidance' ? 'library.config.agent.prompt.edited' : 'library.config.agent.prompt.edited_frozen'
        )
  return (
    <PromptEditorField
      label={<span className="truncate text-muted-foreground text-xs">{status}</span>}
      editorLabel={label}
      value={text}
      onChange={onChange}
      actions={
        <>
          <PromptPolishActions
            value={text}
            fallbackSource={block.text}
            emptyValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            onChange={onChange}
          />
          <RestoreButton
            label={t('library.config.agent.prompt.restore_generated')}
            disabled={override === undefined}
            onClick={onRestore}
          />
        </>
      }
      fill
    />
  )
}

/** The Agent's own prompt; a built-in Agent shows its built-in prompt until it is edited. */
function InstructionsEditor({
  label,
  value,
  builtin,
  overridden,
  resolvedInstructions,
  polishActions,
  portalContainer,
  onChange,
  fill
}: {
  label: ReactNode
  value: string
  builtin: string | undefined
  /** A saved prompt, even one equal to the built-in, keeps the Agent from following later built-in updates. */
  overridden: boolean
  resolvedInstructions: string
  polishActions: ReactNode
  portalContainer: HTMLElement | null
  onChange: (next: string) => void
  /** Fills a dialog page; in a scrolling step it takes a fixed tall height instead. */
  fill: boolean
}) {
  const { t } = useTranslation()
  return (
    <PromptEditorField
      label={
        <div className="flex items-center gap-1.5">
          {label}
          <PromptVariablesPopover portalContainer={portalContainer} />
        </div>
      }
      previewValue={resolvedInstructions}
      editorLabel={t('library.config.agent.prompt.instructions_label')}
      value={value}
      onChange={onChange}
      placeholder={t('library.config.agent.prompt.placeholder')}
      actions={
        <>
          {polishActions}
          {builtin ? (
            <RestoreButton
              label={t('library.config.agent.prompt.restore_builtin')}
              disabled={!overridden}
              onClick={() => onChange('')}
            />
          ) : null}
        </>
      }
      fill={fill}
      minHeight="24rem"
      maxHeight="60vh"
    />
  )
}
