import { Input, Switch } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  placeholder?: string
  description?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
}

interface ProviderConfigFormProps {
  cliTool: string
  config: Record<string, any>
  onConfigChange: (config: Record<string, any>) => void
}

// Claude Code 高级配置字段
const CLAUDE_CODE_FIELDS: ConfigField[] = [
  { key: 'timeoutMs', label: 'API 超时 (ms)', type: 'text', placeholder: '30000', description: 'API 请求超时时间' },
  {
    key: 'maxOutputTokens',
    label: '最大输出 Token',
    type: 'text',
    placeholder: '16384',
    description: '单次响应最大 Token 数'
  },
  {
    key: 'effortLevel',
    label: '推理努力程度',
    type: 'select',
    options: [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' }
    ],
    description: '控制模型推理的深度'
  },
  {
    key: 'autoCompactWindow',
    label: '自动压缩窗口',
    type: 'text',
    placeholder: '100000',
    description: '自动压缩上下文的 Token 阈值'
  },
  { key: 'enableToolSearch', label: '启用工具搜索', type: 'boolean', description: '允许模型搜索可用工具' },
  { key: 'skipWebFetchPreflight', label: '跳过 Web 预检', type: 'boolean', description: '跳过 Web 请求的预检' },
  { key: 'includeCoAuthoredBy', label: '包含共同作者', type: 'boolean', description: '在提交中包含共同作者信息' }
]

// Codex 高级配置字段
const CODEX_FIELDS: ConfigField[] = [
  {
    key: 'reasoningEffort',
    label: '推理努力程度',
    type: 'select',
    options: [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' }
    ],
    description: '控制模型推理的深度'
  },
  { key: 'personality', label: '个性', type: 'text', placeholder: 'pragmatic', description: '助手的个性风格' },
  { key: 'verbosity', label: '详细程度', type: 'text', placeholder: 'concise', description: '响应的详细程度' },
  {
    key: 'contextWindow',
    label: '上下文窗口',
    type: 'number',
    placeholder: '128000',
    min: 1000,
    max: 1000000,
    description: '上下文窗口大小'
  },
  {
    key: 'autoCompactTokenLimit',
    label: '自动压缩 Token 限制',
    type: 'number',
    placeholder: '100000',
    min: 1000,
    max: 1000000,
    description: '自动压缩的 Token 阈值'
  },
  { key: 'reviewModel', label: '审查模型', type: 'text', placeholder: 'gpt-4o', description: '用于代码审查的模型' },
  { key: 'disableResponseStorage', label: '禁用响应存储', type: 'boolean', description: '不存储 API 响应' }
]

// OpenCode 高级配置字段
const OPENCODE_FIELDS: ConfigField[] = [
  { key: 'isReasoning', label: '启用推理', type: 'boolean', description: '启用模型推理能力' },
  { key: 'supportsReasoningEffort', label: '支持推理努力', type: 'boolean', description: '模型是否支持推理努力参数' },
  {
    key: 'budgetTokens',
    label: '推理预算 Token',
    type: 'number',
    placeholder: '10000',
    min: 1000,
    max: 100000,
    description: '推理预算 Token 数量'
  },
  {
    key: 'contextLimit',
    label: '上下文限制',
    type: 'number',
    placeholder: '128000',
    min: 1000,
    max: 1000000,
    description: '上下文 Token 限制'
  },
  {
    key: 'outputLimit',
    label: '输出限制',
    type: 'number',
    placeholder: '16384',
    min: 1000,
    max: 100000,
    description: '输出 Token 限制'
  }
]

// OpenClaw 高级配置字段
const OPENCLAW_FIELDS: ConfigField[] = [
  {
    key: 'api',
    label: 'API 类型',
    type: 'select',
    options: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' }
    ],
    description: '使用的 API 类型'
  },
  { key: 'reasoning', label: '启用推理', type: 'boolean', description: '启用模型推理能力' },
  {
    key: 'contextWindow',
    label: '上下文窗口',
    type: 'number',
    placeholder: '128000',
    min: 1000,
    max: 1000000,
    description: '上下文窗口大小'
  },
  {
    key: 'maxTokens',
    label: '最大 Token',
    type: 'number',
    placeholder: '16384',
    min: 1000,
    max: 100000,
    description: '最大输出 Token 数'
  }
]

// Hermes 高级配置字段
const HERMES_FIELDS: ConfigField[] = [
  {
    key: 'apiMode',
    label: 'API 模式',
    type: 'select',
    options: [
      { value: 'chat_completions', label: 'Chat Completions' },
      { value: 'responses', label: 'Responses' }
    ],
    description: '使用的 API 模式'
  },
  {
    key: 'contextLength',
    label: '上下文长度',
    type: 'number',
    placeholder: '128000',
    min: 1000,
    max: 1000000,
    description: '上下文长度'
  },
  {
    key: 'maxTokens',
    label: '最大 Token',
    type: 'number',
    placeholder: '16384',
    min: 1000,
    max: 100000,
    description: '最大输出 Token 数'
  }
]

const CLI_TOOL_FIELDS: Record<string, ConfigField[]> = {
  claude: CLAUDE_CODE_FIELDS,
  codex: CODEX_FIELDS,
  opencode: OPENCODE_FIELDS,
  openclaw: OPENCLAW_FIELDS,
  hermes: HERMES_FIELDS
}

export const ProviderConfigForm: FC<ProviderConfigFormProps> = ({ cliTool, config, onConfigChange }) => {
  const { t } = useTranslation()
  const fields = CLI_TOOL_FIELDS[cliTool] || []

  const handleChange = (key: string, value: any) => {
    onConfigChange({ ...config, [key]: value })
  }

  if (fields.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-foreground/70 font-medium">{t('code.advanced_config', '高级配置')}</div>

      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <label className="text-xs text-foreground/70 flex items-center gap-1 font-medium">
            {field.label}
            {field.description && <span className="text-muted-foreground/40 text-[10px]">({field.description})</span>}
          </label>

          {field.type === 'text' && (
            <Input
              value={config[field.key] ?? ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full px-3 py-[8px] bg-muted/30 rounded-lg border border-section-border text-sm text-foreground font-mono focus:border-section-border transition-colors h-auto"
            />
          )}

          {field.type === 'number' && (
            <Input
              type="number"
              value={config[field.key] ?? ''}
              onChange={(e) => handleChange(field.key, e.target.value ? Number(e.target.value) : undefined)}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              className="w-full px-3 py-[8px] bg-muted/30 rounded-lg border border-section-border text-sm text-foreground font-mono focus:border-section-border transition-colors h-auto"
            />
          )}

          {field.type === 'boolean' && (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">{field.label}</span>
              <Switch
                size="sm"
                checked={config[field.key] ?? false}
                onCheckedChange={(checked) => handleChange(field.key, checked)}
              />
            </div>
          )}

          {field.type === 'select' && field.options && (
            <select
              value={config[field.key] ?? ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full px-3 py-[8px] bg-muted/30 rounded-lg border border-section-border text-sm text-foreground focus:border-section-border transition-colors h-auto">
              <option value="">选择...</option>
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  )
}

export default ProviderConfigForm
