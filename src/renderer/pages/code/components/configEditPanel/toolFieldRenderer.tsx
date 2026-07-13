import type { Model } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'
import type { ReactNode } from 'react'

import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { GeminiConfigFields } from './tools/GeminiConfigFields'
import { KimiConfigFields } from './tools/KimiConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'
import { QwenConfigFields } from './tools/QwenConfigFields'

interface ToolFieldRenderOptions {
  cliTool: CodeCli
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  section: 'basic' | 'advanced'
  providerId: string
  modelFilter: (model: Model) => boolean
}

export function renderToolFields({
  cliTool,
  config,
  onChange,
  section,
  providerId,
  modelFilter
}: ToolFieldRenderOptions): ReactNode {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      if (section === 'advanced') return null
      return (
        <ClaudeConfigFields
          config={config}
          onChange={onChange}
          section={section}
          providerId={providerId}
          modelFilter={modelFilter}
        />
      )
    case CodeCli.OPENAI_CODEX:
      return <CodexConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.OPEN_CODE:
      return <OpenCodeConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.GEMINI_CLI:
      return <GeminiConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.QWEN_CODE:
      return <QwenConfigFields config={config} onChange={onChange} section={section} />
    case CodeCli.KIMI_CODE:
      return <KimiConfigFields config={config} onChange={onChange} section={section} />
    default:
      return null
  }
}

export function renderClaudeDetailedModelSlot({
  hint,
  config,
  onChange,
  providerId,
  modelFilter
}: Omit<ToolFieldRenderOptions, 'cliTool' | 'section'> & { hint: ReactNode }): ReactNode {
  return (
    <>
      {hint}
      {hint && <div className="h-2" />}
      <ClaudeConfigFields
        config={config}
        onChange={onChange}
        section="advanced"
        providerId={providerId}
        modelFilter={modelFilter}
      />
    </>
  )
}
