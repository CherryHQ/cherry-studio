// 通用工具组件 - 减少重复代码

import type { ReactNode } from 'react'

// 生成 AccordionItem 的标题
export function ToolTitle({
  icon,
  label,
  params,
  stats,
  className = 'text-sm'
}: {
  icon?: ReactNode
  label: string
  params?: string | ReactNode
  stats?: string | ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {icon}
      {label && <span className="font-medium text-sm">{label}</span>}
      {params && <span className="flex-shrink-0 text-muted-foreground text-xs">{params}</span>}
      {stats && <span className="flex-shrink-0 text-muted-foreground text-xs">{stats}</span>}
    </div>
  )
}

// 纯字符串输入工具 (Task, Bash, Search)
export function StringInputTool({
  input,
  label,
  className = ''
}: {
  input: string
  label: string
  className?: string
}) {
  return (
    <div className={className}>
      <div>{label}:</div>
      <div>{input}</div>
    </div>
  )
}

// 单字段输入工具 (pattern, query, file_path 等)
export function SimpleFieldInputTool({
  input,
  label,
  fieldName,
  className = ''
}: {
  input: Record<string, any>
  label: string
  fieldName: string
  className?: string
}) {
  return (
    <div className={className}>
      <div>{label}:</div>
      <div>
        <div>{input[fieldName]}</div>
        {/* 显示其他字段（如 Grep 的 output_mode） */}
        {Object.entries(input)
          .filter(([key]) => key !== fieldName)
          .map(([key, value]) => (
            <span key={key}>
              {key}: {String(value)}
            </span>
          ))}
      </div>
    </div>
  )
}

// 字符串输出工具 (Read, Bash, Search, Glob, WebSearch, Grep 等)
export function StringOutputTool({
  output,
  label,
  className = '',
  textColor = ''
}: {
  output: string
  label: string
  className?: string
  textColor?: string
}) {
  return (
    <div className={className}>
      <div className={textColor}>{label}:</div>
      <div>{output}</div>
    </div>
  )
}
