import { ChevronLeft } from 'lucide-react'
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

import { SettingsLinkButton, SettingsRow, SettingsSection } from './EditDialogPages'
import { PromptPolishActions } from './PromptPolishActions'

const logger = loggerService.withContext('PiPromptField')
const PREVIEW_DEBOUNCE_MS = 300
const fixedTextClassName = 'whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground leading-5'
const editorClassName =
  'min-h-24 border-0 bg-transparent px-0 font-mono text-[12px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent'

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
  /** The block open on its own page; given with `onSectionChange` when a dialog header shows it. */
  section?: string | null
  onSectionChange?: (key: string | null) => void
  /** Shown on the identity page in place of its text, to edit the files it is built from. */
  identityEditor?: ReactNode
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

/** The title key of a prompt block, for a page header that shows one block. */
export function getPromptBlockTitleKey(key: string): string | undefined {
  return BLOCK_TITLES[key]
}

/**
 * A Pi Durable System Prompt: the Agent's own prompt to edit, then the blocks the runtime adds, each
 * opened on its own page. The page is controlled where a dialog header shows it, else local.
 */
export function PiPromptField({
  value,
  onChange,
  draft,
  overrides,
  onOverridesChange,
  section: controlledSection,
  onSectionChange,
  identityEditor
}: PiPromptFieldProps) {
  const { t } = useTranslation()
  const { preview, failed, retry } = usePiPromptPreview(draft, value)
  const [localSection, setLocalSection] = useState<string | null>(null)
  const section = onSectionChange ? (controlledSection ?? null) : localSection
  const setSection = onSectionChange ?? setLocalSection
  const instructions = value || preview?.builtinInstructions || ''
  const overrideOf = (key: string) => (isEditablePromptSection(key) ? overrides?.[key] : undefined)
  const sentText = (block: AgentPromptBlockPreview) =>
    block.kind === 'instructions'
      ? block.text.replace(AGENT_INSTRUCTIONS_SLOT, instructions)
      : (overrideOf(block.key) ?? block.text)
  const tokens = preview ? estimateTokenCount(preview.blocks.map(sentText).join('\n\n')) : null

  const setOverride = (key: string, next: string | undefined) => {
    if (!overrides || !onOverridesChange || !isEditablePromptSection(key)) return
    const rest = { ...overrides }
    delete rest[key]
    onOverridesChange(next === undefined ? rest : { ...rest, [key]: next })
  }

  const opened = preview?.blocks.find((block) => block.key === section && block.kind !== 'instructions')
  if (opened) {
    const editable = opened.kind === 'guidance' && Boolean(overrides) && isEditablePromptSection(opened.key)
    const identity = opened.key === 'agent_identity' ? identityEditor : undefined
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {onSectionChange ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 self-start px-1.5 text-xs"
            onClick={() => setSection(null)}>
            <ChevronLeft className="size-3.5" />
            {t(BLOCK_TITLES[opened.key] ?? '') || opened.key}
          </Button>
        )}
        {identity ??
          (editable ? (
            <GuidanceEditor
              block={opened}
              override={overrideOf(opened.key)}
              onChange={(next) => setOverride(opened.key, next === opened.text ? undefined : next)}
              onRestore={() => setOverride(opened.key, undefined)}
            />
          ) : (
            <BlockViewer block={opened} />
          ))}
      </div>
    )
  }

  const instructionsBlock = preview?.blocks.find((block) => block.kind === 'instructions') ?? STANDALONE_INSTRUCTIONS
  const others = preview?.blocks.filter((block) => block.kind !== 'instructions') ?? []

  return (
    <div className="flex flex-col gap-5">
      <InstructionsEditor
        block={instructionsBlock}
        value={instructions}
        builtin={preview?.builtinInstructions}
        onChange={onChange}
      />
      {preview ? (
        <SettingsSection title={t('library.config.agent.prompt.runtime_sections')}>
          {others.map((block) => {
            const edited = overrideOf(block.key) !== undefined
            const summary =
              block.kind === 'guidance'
                ? t(edited ? 'library.config.agent.prompt.edited' : 'library.config.agent.prompt.summary.generated')
                : t('library.config.agent.prompt.summary.live')
            const label = BLOCK_TITLES[block.key] ? t(BLOCK_TITLES[block.key]) : block.key
            return (
              <SettingsRow key={block.key} label={label}>
                <SettingsLinkButton label={label} summary={summary} onClick={() => setSection(block.key)} />
              </SettingsRow>
            )
          })}
        </SettingsSection>
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
function BlockViewer({ block }: { block: AgentPromptBlockPreview }) {
  const { t } = useTranslation()
  const caption = BLOCK_CAPTIONS[block.key]
  return (
    <div className="flex flex-col gap-2">
      {caption ? <p className="text-muted-foreground text-xs">{t(caption)}</p> : null}
      <pre className={`${fixedTextClassName} rounded-xl bg-muted/40 px-3 py-2.5`}>{block.text}</pre>
    </div>
  )
}

function GuidanceEditor({
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
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
      </div>
      <div className="rounded-xl border border-border px-3 py-1">
        <Textarea.Input value={text} aria-label={label} onValueChange={onChange} className={editorClassName} />
      </div>
    </div>
  )
}

/** The Agent's own prompt; a built-in Agent shows its built-in prompt until it is edited. */
function InstructionsEditor({
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="font-medium text-foreground text-sm">{t(BLOCK_TITLES[block.key] ?? '')}</span>
        <span className="flex items-center gap-1">
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
        </span>
      </div>
      <div className="rounded-xl border border-border px-3 py-1">
        <Textarea.Input
          value={value}
          aria-label={t('library.config.agent.prompt.instructions_label')}
          placeholder={t('library.config.agent.prompt.placeholder')}
          onValueChange={onChange}
          // Capped so the blocks below stay in reach on the same page.
          className={`${editorClassName} max-h-72`}
        />
      </div>
    </div>
  )
}
