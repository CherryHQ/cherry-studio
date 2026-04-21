import { CodeEditor, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { estimateTextTokens } from '@renderer/services/TokenService'
import type { Assistant } from '@shared/data/types/assistant'
import { Edit, Eye, HelpCircle } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface Props {
  assistant: Assistant
  prompt: string
  onChange: (prompt: string) => void
}

/** Variable catalogue — mirrors legacy `assistants.presets.add.prompt.variables.tip.content`. */
const PROMPT_VARIABLES: { name: string; desc: string }[] = [
  { name: '{{date}}', desc: '日期' },
  { name: '{{time}}', desc: '时间' },
  { name: '{{datetime}}', desc: '日期和时间' },
  { name: '{{system}}', desc: '操作系统' },
  { name: '{{arch}}', desc: 'CPU 架构' },
  { name: '{{language}}', desc: '语言' },
  { name: '{{model_name}}', desc: '模型名称' },
  { name: '{{username}}', desc: '用户名' }
]

/**
 * Prompt editor — writes the top-level `prompt` column on the assistant.
 *
 * Feature parity with the legacy `AssistantPromptSettings` *prompt* half
 * (name / emoji live in BasicSection in v2). Keeps CodeEditor (markdown) /
 * ReactMarkdown preview toggle, 8-variable tooltip, Token count, and
 * double-click-preview-to-edit. Save cadence is the v2 top-bar global PATCH,
 * not the legacy's per-field instant save.
 *
 * TODO(v2-llm-migration): `usePromptProcessor` → `replacePromptVariables`
 * transitively reads Redux (`store.getState().llm.defaultModel?.name` fallback
 * when `assistant.modelName` is null) and legacy IPC
 * (`window.api.system.getDeviceType()` / `window.api.getAppInfo().arch` for
 * {{system}} / {{arch}}). Same Redux / legacy-IPC cluster as BasicSection's
 * ModelAvatar / SelectChatModelPopup / useProviders — should land together in
 * the same follow-up PR. Kept here so the editor matches legacy UX.
 */
const PromptSection: FC<Props> = ({ assistant, prompt, onChange }) => {
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [showPreview, setShowPreview] = useState(prompt.length > 0)

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant.modelName ?? undefined
  })

  const tokenCount = useMemo(() => estimateTextTokens(prompt), [prompt])

  // Flip back to edit mode when the prompt becomes empty (e.g. cleared in
  // another window) — there's nothing to preview.
  useEffect(() => {
    if (prompt.length === 0 && showPreview) setShowPreview(false)
  }, [prompt, showPreview])

  const variablesTip = (
    <div className="min-w-[200px]">
      <div className="mb-1.5 font-medium text-[11px] text-foreground">可用的变量</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
        {PROMPT_VARIABLES.map((v) => (
          <div key={v.name} className="contents">
            <span className="text-foreground/80">{v.name}</span>
            <span>{v.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">提示词</h3>
        <p className="text-[10px] text-muted-foreground/55">系统提示词将作为该助手的上下文开头发送给模型</p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <span>系统提示词</span>
            <Tooltip content={variablesTip} placement="top" classNames={{ content: 'max-w-none' }}>
              <HelpCircle size={11} className="cursor-help text-muted-foreground/50 hover:text-foreground" />
            </Tooltip>
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            disabled={prompt.length === 0}
            className="flex items-center gap-1 rounded-3xs border border-border/20 px-2 py-[3px] text-[10px] text-muted-foreground/50 transition-colors hover:bg-accent/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
            {showPreview ? <Edit size={10} /> : <Eye size={10} />}
            <span>{showPreview ? '编辑' : '预览'}</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-2xs border border-border/20 bg-accent/10 transition-all focus-within:border-border/40 focus-within:bg-accent/15">
          {showPreview ? (
            <div
              className="markdown max-h-[50vh] min-h-[200px] overflow-auto p-3 text-[11px] text-foreground"
              onDoubleClick={() => setShowPreview(false)}>
              <ReactMarkdown>{processedPrompt || prompt}</ReactMarkdown>
            </div>
          ) : (
            <CodeEditor
              theme={activeCmTheme}
              fontSize={fontSize - 1}
              value={prompt}
              language="markdown"
              onChange={onChange}
              expanded={false}
              minHeight="200px"
              maxHeight="50vh"
              placeholder="在这里输入系统提示词,支持 {{date}} / {{model_name}} 等变量..."
            />
          )}
        </div>

        <div className="mt-1.5 flex justify-between text-[9px] text-muted-foreground/40">
          <span>双击预览区可切回编辑</span>
          <span className="tabular-nums">Tokens: {tokenCount}</span>
        </div>
      </div>
    </div>
  )
}

export default PromptSection
