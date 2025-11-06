import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import { CheckCircle, Terminal, XCircle } from 'lucide-react'
import { useMemo } from 'react'

import { ToolTitle } from './GenericTools'
import type { BashOutputToolInput, BashOutputToolOutput } from './types'
import { AgentToolsType } from './types'

interface ParsedBashOutput {
  status?: string
  exit_code?: number
  stdout?: string
  stderr?: string
  timestamp?: string
  tool_use_error?: string
}

export function BashOutputTool({
  input,
  output
}: {
  input: BashOutputToolInput
  output?: BashOutputToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  // 解析 XML 输出
  const parsedOutput = useMemo(() => {
    if (!output) return null

    try {
      const parser = new DOMParser()
      // 检查是否包含 tool_use_error 标签
      const hasToolError = output.includes('<tool_use_error>')
      // 包装成有效的 XML（如果还没有根元素）
      const xmlStr = output.includes('<status>') || hasToolError ? `<root>${output}</root>` : output
      const xmlDoc = parser.parseFromString(xmlStr, 'application/xml')

      // 检查是否有解析错误
      const parserError = xmlDoc.querySelector('parsererror')
      if (parserError) {
        return null
      }

      const getElementText = (tagName: string): string | undefined => {
        const element = xmlDoc.getElementsByTagName(tagName)[0]
        return element?.textContent?.trim()
      }

      const result: ParsedBashOutput = {
        status: getElementText('status'),
        exit_code: getElementText('exit_code') ? parseInt(getElementText('exit_code')!) : undefined,
        stdout: getElementText('stdout'),
        stderr: getElementText('stderr'),
        timestamp: getElementText('timestamp'),
        tool_use_error: getElementText('tool_use_error')
      }

      return result
    } catch {
      return null
    }
  }, [output])

  // 获取状态配置
  const statusConfig = useMemo(() => {
    if (!parsedOutput) return null

    // 如果有 tool_use_error，直接显示错误状态
    if (parsedOutput.tool_use_error) {
      return {
        color: 'danger',
        icon: <XCircle className="h-3.5 w-3.5" />,
        text: 'Error'
      } as const
    }

    const isCompleted = parsedOutput.status === 'completed'
    const isSuccess = parsedOutput.exit_code === 0

    return {
      color: isCompleted && isSuccess ? 'success' : isCompleted && !isSuccess ? 'danger' : 'warning',
      icon:
        isCompleted && isSuccess ? (
          <CheckCircle className="h-3.5 w-3.5" />
        ) : isCompleted && !isSuccess ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <Terminal className="h-3.5 w-3.5" />
        ),
      text: isCompleted ? (isSuccess ? 'Success' : 'Failed') : 'Running'
    } as const
  }, [parsedOutput])

  const children = parsedOutput ? (
    <div className="flex flex-col gap-4">
      {/* Status Info */}
      <div className="flex flex-wrap items-center gap-2">
        {parsedOutput.exit_code !== undefined && (
          <Tag color={parsedOutput.exit_code === 0 ? 'success' : 'danger'}>Exit Code: {parsedOutput.exit_code}</Tag>
        )}
        {parsedOutput.timestamp && (
          <Tag className="py-0 font-mono text-xs">{new Date(parsedOutput.timestamp).toLocaleString()}</Tag>
        )}
      </div>

      {/* Standard Output */}
      {parsedOutput.stdout && (
        <div>
          <div className="mb-2 font-medium text-default-600 text-xs">stdout:</div>
          <pre className="whitespace-pre-wrap font-mono text-default-700 text-xs dark:text-default-300">
            {parsedOutput.stdout}
          </pre>
        </div>
      )}

      {/* Standard Error */}
      {parsedOutput.stderr && (
        <div className="border border-danger-200">
          <div className="mb-2 font-medium text-danger-600 text-xs">stderr:</div>
          <pre className="whitespace-pre-wrap font-mono text-danger-600 text-xs dark:text-danger-400">
            {parsedOutput.stderr}
          </pre>
        </div>
      )}

      {/* Tool Use Error */}
      {parsedOutput.tool_use_error && (
        <div className="border border-danger-200">
          <div className="mb-2 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-danger" />
            <span className="font-medium text-danger-600 text-xs">Error:</span>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-danger-600 text-xs dark:text-danger-400">
            {parsedOutput.tool_use_error}
          </pre>
        </div>
      )}
    </div>
  ) : (
    // 原始输出（如果解析失败或非 XML 格式）
    output && (
      <div>
        <pre className="whitespace-pre-wrap font-mono text-default-700 text-xs dark:text-default-300">{output}</pre>
      </div>
    )
  )
  return {
    key: AgentToolsType.BashOutput,
    label: (
      <>
        <ToolTitle
          icon={<Terminal className="h-4 w-4" />}
          label="Bash Output"
          params={
            <div className="flex items-center gap-2">
              <Tag className="py-0 font-mono text-xs">{input.bash_id}</Tag>
              {statusConfig && (
                <Tag
                  color={statusConfig.color}
                  icon={statusConfig.icon}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '2px'
                  }}>
                  {statusConfig.text}
                </Tag>
              )}
            </div>
          }
        />
      </>
    ),

    children: children
  }
}
