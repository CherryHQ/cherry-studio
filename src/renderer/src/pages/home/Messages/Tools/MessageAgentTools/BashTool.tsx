import type { CollapseProps } from 'antd'
import { Popover, Tag } from 'antd'
import { Terminal } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { BashToolInput as BashToolInputType, BashToolOutput as BashToolOutputType } from './types'

const MAX_TAG_LENGTH = 100

export function BashTool({
  input,
  output
}: {
  input: BashToolInputType
  output?: BashToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算输出行数
  const outputLines = output ? output.split('\n').length : 0

  // 处理命令字符串的截断
  const command = input.command
  const needsTruncate = command.length > MAX_TAG_LENGTH
  const displayCommand = needsTruncate ? `${command.slice(0, MAX_TAG_LENGTH)}...` : command

  const tagContent = <Tag className="whitespace-pre-wrap break-all font-mono">{displayCommand}</Tag>

  return {
    key: 'tool',
    label: (
      <>
        <ToolTitle
          icon={<Terminal className="h-4 w-4" />}
          label="Bash"
          params={input.description}
          stats={output ? `${outputLines} ${outputLines === 1 ? 'line' : 'lines'}` : undefined}
        />
        <div className="mt-1">
          {needsTruncate ? (
            <Popover
              content={<div className="max-w-xl whitespace-pre-wrap break-all font-mono">{command}</div>}
              trigger="hover">
              {tagContent}
            </Popover>
          ) : (
            tagContent
          )}
        </div>
      </>
    ),
    children: <div className="whitespace-pre-line">{output}</div>
  }
}
