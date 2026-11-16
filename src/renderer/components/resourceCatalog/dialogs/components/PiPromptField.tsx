import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount } from 'tokenx'

import { Button, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT } from '@renderer/utils/resourceCatalog'
import { type AgentLanguageMode, normalizeAgentLanguageInput } from '@shared/ai/agentForm'
import {
  AGENT_INSTRUCTIONS_SLOT,
  type AgentPromptOverrides,
  isEditablePromptSection
} from '@shared/ai/agentPromptSections'
import type {
  AgentPromptBlockPreview,
  AgentSystemPromptDraft,
  AgentSystemPromptPreview
} from '@shared/ipc/schemas/agent'

import { PromptPolishActions } from './PromptPolishActions'

const logger = loggerService.withContext('PiPromptField')
const PREVIEW_DEBOUNCE_MS = 300
const fixedTextClassName = 'whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground leading-5'
const editorClassName =
  'max-h-96 min-h-16 border-0 bg-transparent px-0 font-mono text-[12px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent'

const BLOCK_TITLES: Record<string, string> = {
  agent_identity: 'library.config.agent.prompt.block.agent_identity',
  project_context: 'library.config.agent.prompt.block.project_context',
  skills: 'library.config.agent.prompt.block.skills',
  mcp_instructions: 'library.config.agent.prompt.block.mcp_instructions',
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
  mcp_instructions: 'library.config.agent.prompt.caption.mcp_instructions',
  workspace_system: 'library.config.agent.prompt.caption.workspace_system',
  language: 'library.config.agent.prompt.caption.language'
}

const STANDALONE_INSTRUCTIONS: AgentPromptBlockPreview = {
  key: 'instructions',
  kind: 'instructions',
  text: AGENT_INSTRUCTIONS_SLOT
}

/** Everything besides the instructions that changes the assembled prompt. */
export type PiPromptDraft = Omit<AgentSystemPromptDraft, 'instructions' | 'language'> & {
  languageMode: AgentLanguageMode
  languageCustom: string
}

type PiPromptFieldProps = {
  value: string
  onChange: (value: string) => void
  draft: PiPromptDraft
  /** Given only where the Agent exists: guidance blocks are then editable and saved here. */
  overrides?: AgentPromptOverrides
  onOverridesChange?: (next: AgentPromptOverrides) => void
}

/** Mirrors how the edit form saves `configuration.language`; an invalid custom label keeps the inherited one. */
function draftLanguage({ languageMode, languageCustom }: PiPromptDraft): string | null | undefined {
  if (languageMode === 'off') return null
  if (languageMode === 'custom') return normalizeAgentLanguageInput(languageCustom) ?? undefined
  return undefined
}

function usePiPromptPreview(draft: PiPromptDraft, instructions: string) {
  const [preview, setPreview] = useState<AgentSystemPromptPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const instructionsRef = useRef(instructions)
  useEffect(() => {
    instructionsRef.current = instructions
  })
  const { agentId, skillIds, disabledTools, knowledgeBaseIds, mcpServerIds } = draft
  const language = draftLanguage(draft)
  const request: Omit<AgentSystemPromptDraft, 'instructions'> = {
    ...(agentId ? { agentId } : {}),
    ...(language === undefined ? {} : { language }),
    skillIds,
    disabledTools,
    knowledgeBaseIds,
    mcpServerIds
  }
  // The assembly only depends on whether instructions exist; their text sits in the editable slot.
  const requestKey = JSON.stringify([request, Boolean(instructions.trim())])

  useEffect(() => {
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
  }, [requestKey, attempt])

  return { preview, failed, retry: () => setAttempt((count) => count + 1) }
}

/** The full Pi Durable System Prompt, block by block: guidance and the Agent's own prompt can be edited. */
export function PiPromptField({ value, onChange, draft, overrides, onOverridesChange }: PiPromptFieldProps) {
  const { t } = useTranslation()
  const { preview, failed, retry } = usePiPromptPreview(draft, value)
  const instructions = value || preview?.builtinInstructions || ''
  const sentText = (block: AgentPromptBlockPreview) =>
    block.kind === 'instructions'
      ? block.text.replace(AGENT_INSTRUCTIONS_SLOT, instructions)
      : isEditablePromptSection(block.key)
        ? (overrides?.[block.key] ?? block.text)
        : block.text
  const tokens = preview ? estimateTokenCount(preview.blocks.map(sentText).join('\n\n')) : null

  const setOverride = (key: string, next: string | undefined) => {
    if (!overrides || !onOverridesChange || !isEditablePromptSection(key)) return
    const { [key]: _previous, ...rest } = overrides
    onOverridesChange(next === undefined ? rest : { ...rest, [key]: next })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground text-sm leading-none">
            {t('library.config.prompt.label')}
          </span>
          <span className="text-muted-foreground text-xs">{t('library.config.agent.prompt.full_hint')}</span>
        </div>
        {tokens !== null ? (
          <span className="shrink-0 text-foreground-tertiary text-xs tabular-nums">
            {t('library.config.agent.prompt.tokens', { tokens: tokens.toLocaleString() })}
          </span>
        ) : null}
      </div>
      {preview ? (
        preview.blocks.map((block) =>
          block.kind === 'instructions' ? (
            <InstructionsBlock
              key={block.key}
              block={block}
              value={instructions}
              builtin={preview.builtinInstructions}
              onChange={onChange}
            />
          ) : block.kind === 'guidance' && overrides && isEditablePromptSection(block.key) ? (
            <GuidanceBlock
              key={block.key}
              block={block}
              override={overrides[block.key]}
              onChange={(next) => setOverride(block.key, next === block.text ? undefined : next)}
              onRestore={() => setOverride(block.key, undefined)}
            />
          ) : (
            <FixedBlock key={block.key} block={block} />
          )
        )
      ) : (
        <>
          <p role="status" className="py-2 text-muted-foreground text-xs">
            {failed ? t('library.config.agent.prompt.load_failed') : t('library.config.agent.prompt.loading')}
          </p>
          {/* The Agent's own prompt stays editable while the rest cannot be assembled. */}
          <InstructionsBlock block={STANDALONE_INSTRUCTIONS} value={value} builtin={undefined} onChange={onChange} />
        </>
      )}
      {failed ? (
        <div className="flex items-center gap-2 text-destructive text-xs">
          {preview ? t('library.config.agent.prompt.load_failed') : null}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function BlockFrame({
  block,
  note,
  actions,
  editable,
  children
}: {
  block: AgentPromptBlockPreview
  note?: string
  actions?: ReactNode
  editable?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const title = BLOCK_TITLES[block.key] ? t(BLOCK_TITLES[block.key]) : block.key
  return (
    <section
      aria-label={title}
      className={
        editable
          ? 'rounded-xl border border-border bg-background px-3 py-2'
          : 'rounded-xl border border-border-subtle bg-muted/30 px-3 py-2'
      }>
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-medium text-foreground text-xs">{title}</span>
          {note ? <span className="truncate text-foreground-tertiary text-xs">{note}</span> : null}
        </span>
        {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** Live data, a setting's output, or guidance shown before the Agent exists: read-only. */
function FixedBlock({ block }: { block: AgentPromptBlockPreview }) {
  const { t } = useTranslation()
  const note = BLOCK_CAPTIONS[block.key] ? t(BLOCK_CAPTIONS[block.key]) : undefined
  return (
    <BlockFrame block={block} note={note}>
      <pre className={`${fixedTextClassName} max-h-40 overflow-y-auto`}>{block.text}</pre>
    </BlockFrame>
  )
}

function GuidanceBlock({
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
  return (
    <BlockFrame
      block={block}
      editable
      note={override !== undefined ? t('library.config.agent.prompt.edited') : undefined}
      actions={
        <>
          <PromptPolishActions
            value={text}
            fallbackSource={block.text}
            emptyValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            onChange={onChange}
          />
          {override !== undefined ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onRestore}>
              {t('library.config.agent.prompt.restore_generated')}
            </Button>
          ) : null}
        </>
      }>
      <Textarea.Input
        value={text}
        aria-label={BLOCK_TITLES[block.key] ? t(BLOCK_TITLES[block.key]) : block.key}
        onValueChange={onChange}
        className={editorClassName}
      />
    </BlockFrame>
  )
}

/** The Agent's own prompt; a built-in Agent shows its built-in prompt until it is edited. */
function InstructionsBlock({
  block,
  value,
  builtin,
  onChange
}: {
  block: AgentPromptBlockPreview
  value: string
  builtin: string | undefined
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const [before, after = ''] = block.text.split(AGENT_INSTRUCTIONS_SLOT)
  return (
    <BlockFrame
      block={block}
      editable
      actions={
        <>
          <PromptPolishActions
            value={value}
            emptyValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            existingValueSystemPrompt={RESOURCE_PROMPT_POLISH_SYSTEM_PROMPT}
            onChange={onChange}
          />
          {builtin && value !== builtin ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange('')}>
              {t('library.config.agent.prompt.restore_builtin')}
            </Button>
          ) : null}
        </>
      }>
      {before.trim() ? <pre className={fixedTextClassName}>{before.trimEnd()}</pre> : null}
      <div className="my-1 rounded-lg bg-accent/40 px-2 ring-1 ring-border">
        <Textarea.Input
          value={value}
          aria-label={t('library.config.agent.prompt.instructions_label')}
          placeholder={t('library.config.agent.prompt.placeholder')}
          onValueChange={onChange}
          className={editorClassName}
        />
      </div>
      {after.trim() ? <pre className={fixedTextClassName}>{after.trimStart()}</pre> : null}
    </BlockFrame>
  )
}
