import type { Assistant } from '@shared/data/types/assistant'
import { ArrowLeft, BookOpen, ChevronRight, FileText, Save, Settings, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../adapters/tagAdapter'
import { type BasicFormState, BasicSection, initialBasicFormState } from './sections/BasicSection'
import PlaceholderSection from './sections/PlaceholderSection'

type Section = 'basic' | 'prompt' | 'knowledge' | 'tools'

const sections: { id: Section; label: string; icon: typeof Settings; desc: string }[] = [
  { id: 'basic', label: '基础设置', icon: Settings, desc: '名称、头像、模型参数' },
  { id: 'prompt', label: '提示词', icon: FileText, desc: '系统提示词、变量、样本' },
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
 * all sections (currently only BasicSection; future Prompt/Knowledge/Tool
 * sections extend the same `form` object) and only committed on 保存 — 取消
 * simply discards the in-memory state.
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
      customParametersChanged,
    [baseline, form, customParametersChanged]
  )

  const isDirty = columnsChanged || tagsChanged

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
                customParameters: form.customParameters
              }
            }
          : {}),
        ...(tagIdsPayload !== undefined ? { tagIds: tagIdsPayload } : {})
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [saving, isDirty, columnsChanged, tagsChanged, updateAssistant, ensureTags, form, assistant])

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
      <SectionBody
        section={activeSection}
        body={
          <BasicSection
            assistant={assistant}
            form={form}
            onChange={handleChange}
            tagColorByName={tagColorByName}
            allTagNames={allTagNames}
          />
        }
      />
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
          <Save size={10} />
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

function SectionBody({ section, body }: { section: Section; body: ReactNode }) {
  if (section === 'basic') return <>{body}</>
  if (section === 'prompt')
    return (
      <PlaceholderSection
        icon={FileText}
        title="提示词配置即将上线"
        description="系统提示词、变量与样本的编辑能力在后续版本开放"
      />
    )
  if (section === 'knowledge')
    return (
      <PlaceholderSection
        icon={BookOpen}
        title="知识库关联即将上线"
        description="关联知识库与检索策略的能力在后续版本开放"
      />
    )
  return (
    <PlaceholderSection icon={Wrench} title="工具配置即将上线" description="MCP 服务与工具的挂载能力在后续版本开放" />
  )
}
