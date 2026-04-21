import type { Assistant } from '@shared/data/types/assistant'
import { ArrowLeft, BookOpen, ChevronRight, FileText, Save, Settings, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../adapters/tagAdapter'
import { type BasicFormState, BasicSection, initialBasicFormState } from './sections/BasicSection'
import KnowledgeSection from './sections/KnowledgeSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'

type Section = 'basic' | 'prompt' | 'knowledge' | 'tools'

const sections: { id: Section; label: string; icon: typeof Settings; desc: string }[] = [
  { id: 'basic', label: '基础设置', icon: Settings, desc: '名称、头像、模型参数' },
  { id: 'prompt', label: '提示词', icon: FileText, desc: '系统提示词与变量' },
  { id: 'knowledge', label: '知识库', icon: BookOpen, desc: '关联知识库、检索策略' },
  { id: 'tools', label: '工具', icon: Wrench, desc: 'MCP 服务与工具配置' }
]

interface Props {
  assistant: Assistant
  onBack: () => void
}

/**
 * Assistant editor.
 *
 * Creation is handled by LibraryPage (POST /assistants on click) so this page
 * always operates against an existing row. Form state is kept locally across
 * all sections — Basic / Prompt / Knowledge / Tools share the same `form`
 * object so every section's edits land in a single PATCH on 保存; 取消 simply
 * discards the in-memory state.
 *
 * Save flow collapses to a single PATCH:
 *   1. Resolve typed tag names → tag ids (`ensureTags` POSTs any missing ones).
 *   2. PATCH /assistants/:id with the full field diff, including `tagIds` when
 *      the tag set changed. The backend syncs `entity_tag` inside the same
 *      transaction as the assistant-row update — atomic by construction.
 */
const AssistantConfigPage: FC<Props> = ({ assistant, onBack }) => {
  const [activeSection, setActiveSection] = useState<Section>('basic')
  const [form, setForm] = useState<BasicFormState>(() => initialBasicFormState(assistant))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { updateAssistant } = useAssistantMutationsById(assistant.id)
  const { ensureTags } = useEnsureTags()
  const tagList = useTagList()
  const tagColorByName = useMemo(
    () => new Map(tagList.tags.map((t) => [t.name, t.color ?? ''] as const).filter(([, c]) => c !== '')),
    [tagList.tags]
  )
  const allTagNames = useMemo(() => tagList.tags.map((t) => t.name), [tagList.tags])

  const baseline = useMemo(() => initialBasicFormState(assistant), [assistant])

  const handleChange = useCallback((patch: Partial<BasicFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const tagsChanged = useMemo(() => {
    if (baseline.tags.length !== form.tags.length) return true
    const a = [...baseline.tags].sort()
    const b = [...form.tags].sort()
    return a.some((v, i) => v !== b[i])
  }, [baseline.tags, form.tags])

  const customParametersChanged = useMemo(() => {
    if (baseline.customParameters.length !== form.customParameters.length) return true
    // Shallow structural comparison — parameter order matters, values are
    // primitives or JSON strings. Stringify is cheap and unambiguous here.
    return JSON.stringify(baseline.customParameters) !== JSON.stringify(form.customParameters)
  }, [baseline.customParameters, form.customParameters])

  const knowledgeBaseIdsChanged = useMemo(
    () => !sameIdSet(baseline.knowledgeBaseIds, form.knowledgeBaseIds),
    [baseline.knowledgeBaseIds, form.knowledgeBaseIds]
  )

  const mcpServerIdsChanged = useMemo(
    () => !sameIdSet(baseline.mcpServerIds, form.mcpServerIds),
    [baseline.mcpServerIds, form.mcpServerIds]
  )

  // Excludes relation-array diffs — those ship as their own PATCH keys so
  // unchanged junction bindings are not re-sent on every column edit.
  const columnsChanged = useMemo(
    () =>
      baseline.name !== form.name ||
      baseline.emoji !== form.emoji ||
      baseline.description !== form.description ||
      baseline.modelId !== form.modelId ||
      baseline.temperature !== form.temperature ||
      baseline.enableTemperature !== form.enableTemperature ||
      baseline.topP !== form.topP ||
      baseline.enableTopP !== form.enableTopP ||
      baseline.maxTokens !== form.maxTokens ||
      baseline.enableMaxTokens !== form.enableMaxTokens ||
      baseline.contextCount !== form.contextCount ||
      baseline.streamOutput !== form.streamOutput ||
      baseline.toolUseMode !== form.toolUseMode ||
      baseline.maxToolCalls !== form.maxToolCalls ||
      baseline.enableMaxToolCalls !== form.enableMaxToolCalls ||
      baseline.prompt !== form.prompt ||
      baseline.mcpMode !== form.mcpMode ||
      customParametersChanged,
    [baseline, form, customParametersChanged]
  )

  const isDirty = columnsChanged || tagsChanged || knowledgeBaseIdsChanged || mcpServerIdsChanged

  const handleSave = useCallback(async () => {
    if (saving || !isDirty) return
    setSaving(true)
    setError(null)
    try {
      // Resolve any newly-typed tag names to ids BEFORE the PATCH so the payload
      // carries authoritative tag ids — the assistant PATCH then binds them
      // atomically with the assistant-row update.
      const tagIdsPayload = tagsChanged ? (await ensureTags(form.tags)).map((t) => t.id) : undefined

      await updateAssistant({
        ...(columnsChanged
          ? {
              name: form.name.trim() || assistant.name,
              emoji: form.emoji,
              description: form.description,
              modelId: form.modelId,
              prompt: form.prompt,
              settings: {
                ...assistant.settings,
                temperature: form.temperature,
                enableTemperature: form.enableTemperature,
                topP: form.topP,
                enableTopP: form.enableTopP,
                maxTokens: form.maxTokens,
                enableMaxTokens: form.enableMaxTokens,
                contextCount: form.contextCount,
                streamOutput: form.streamOutput,
                toolUseMode: form.toolUseMode,
                maxToolCalls: form.maxToolCalls,
                enableMaxToolCalls: form.enableMaxToolCalls,
                customParameters: form.customParameters,
                mcpMode: form.mcpMode
              }
            }
          : {}),
        ...(knowledgeBaseIdsChanged ? { knowledgeBaseIds: form.knowledgeBaseIds } : {}),
        ...(mcpServerIdsChanged ? { mcpServerIds: form.mcpServerIds } : {}),
        ...(tagIdsPayload !== undefined ? { tagIds: tagIdsPayload } : {})
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [
    saving,
    isDirty,
    columnsChanged,
    tagsChanged,
    knowledgeBaseIdsChanged,
    mcpServerIdsChanged,
    updateAssistant,
    ensureTags,
    form,
    assistant
  ])

  return (
    <ConfigShell
      title={assistant.name}
      saving={saving}
      saved={saved}
      error={error}
      canSave={isDirty}
      onSave={handleSave}
      onBack={onBack}
      activeSection={activeSection}
      onSectionChange={setActiveSection}>
      {activeSection === 'basic' && (
        <BasicSection
          assistant={assistant}
          form={form}
          onChange={handleChange}
          tagColorByName={tagColorByName}
          allTagNames={allTagNames}
        />
      )}
      {activeSection === 'prompt' && (
        <PromptSection assistant={assistant} prompt={form.prompt} onChange={(prompt) => handleChange({ prompt })} />
      )}
      {activeSection === 'knowledge' && (
        <KnowledgeSection
          value={form.knowledgeBaseIds}
          onChange={(knowledgeBaseIds) => handleChange({ knowledgeBaseIds })}
        />
      )}
      {activeSection === 'tools' && (
        <ToolsSection
          mcpMode={form.mcpMode}
          mcpServerIds={form.mcpServerIds}
          onModeChange={(mcpMode) => handleChange({ mcpMode })}
          onServerIdsChange={(mcpServerIds) => handleChange({ mcpServerIds })}
        />
      )}
    </ConfigShell>
  )
}

export default AssistantConfigPage

// ============================================================================
// Shared shell (top bar + section sidebar)
// ============================================================================

interface ShellProps {
  title: string
  saving: boolean
  saved: boolean
  error: string | null
  canSave: boolean
  onSave: () => void
  onBack: () => void
  activeSection: Section
  onSectionChange: (section: Section) => void
  children: ReactNode
}

function ConfigShell({
  title,
  saving,
  saved,
  error,
  canSave,
  onSave,
  onBack,
  activeSection,
  onSectionChange,
  children
}: ShellProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-border/15 border-b px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-3xs text-muted-foreground/40 transition-colors hover:bg-accent/40 hover:text-foreground">
          <ArrowLeft size={14} />
        </button>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <span className="cursor-pointer transition-colors hover:text-foreground" onClick={onBack}>
            资源库
          </span>
          <ChevronRight size={9} />
          <span className="text-foreground">{title}</span>
        </div>
        <div className="flex-1" />
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-primary">
              已保存
            </motion.span>
          )}
          {error && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-destructive">
              {error}
            </motion.span>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={onBack}
          className="rounded-3xs border border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground/50 transition-all hover:bg-accent/30 hover:text-foreground">
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave}
          className="flex items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 text-[11px] text-background transition-colors hover:bg-foreground/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">
          <Save size={10} className="lucide-custom" />
          <span>{saving ? '保存中...' : '保存'}</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] shrink-0 border-border/10 border-r p-3">
          {sections.map((s) => {
            const Icon = s.icon
            const active = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSectionChange(s.id)}
                className={`mb-1 flex w-full items-start gap-2.5 rounded-2xs px-3 py-2.5 text-left transition-all ${
                  active
                    ? 'bg-accent/60 text-foreground'
                    : 'text-muted-foreground/60 hover:bg-accent/25 hover:text-foreground'
                }`}>
                <Icon size={13} strokeWidth={1.6} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px]">{s.label}</div>
                  <div
                    className={`mt-px text-[9px] ${active ? 'text-muted-foreground/50' : 'text-muted-foreground/45'}`}>
                    {s.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/** Order-insensitive id-set equality; junction tables don't carry ordering. */
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
