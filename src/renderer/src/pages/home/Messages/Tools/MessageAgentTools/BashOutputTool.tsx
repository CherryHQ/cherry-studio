import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import { CheckCircle, Terminal, XCircle } from 'lucide-react'

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

const parseBashOutput = (output?: BashOutputToolOutput): ParsedBashOutput | null => {
  if (!output) return null

  try {
    const parser = new DOMParser()
    const hasToolError = output.includes('<tool_use_error>')
    const xmlStr = output.includes('<status>') || hasToolError ? `<root>${output}</root>` : output
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml')
    const parserError = xmlDoc.querySelector('parsererror')
    if (parserError) return null

    const getElementText = (tagName: string): string | undefined => {
      const element = xmlDoc.getElementsByTagName(tagName)[0]
      return element?.textContent?.trim()
    }

    return {
      status: getElementText('status'),
      exit_code: getElementText('exit_code') ? parseInt(getElementText('exit_code')!) : undefined,
      stdout: getElementText('stdout'),
      stderr: getElementText('stderr'),
      timestamp: getElementText('timestamp'),
      tool_use_error: getElementText('tool_use_error')
    }
  } catch {
    return null
  }
}

const getStatusConfig = (parsedOutput: ParsedBashOutput | null) => {
  if (!parsedOutput) return null

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
}

export function BashOutputTool({
  input,
  output
}: {
  input?: BashOutputToolInput
  output?: BashOutputToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const parsedOutput = parseBashOutput(output)
  const statusConfig = getStatusConfig(parsedOutput)

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
              <Tag className="py-0 font-mono text-xs">{input?.bash_id}</Tag>
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
