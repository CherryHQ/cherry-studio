import type { CollapseProps } from 'antd'
import { Popover, Tag } from 'antd'
import { Terminal } from 'lucide-react'

import { SkeletonValue, ToolTitle } from './GenericTools'
import type { BashToolInput as BashToolInputType, BashToolOutput as BashToolOutputType } from './types'

export function BashTool({
  input,
  output
}: {
  input?: BashToolInputType
  output?: BashToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 如果有输出，计算输出行数
  const outputLines = output ? output.split('\n').length : 0

  // 处理命令字符串，添加空值检查
  const command = input?.command

  const tagContent = (
    <Tag className="m-0! max-w-full truncate font-mono">
      <SkeletonValue value={command} width="200px" />
    </Tag>
  )

  return {
    key: 'tool',
    label: (
      <>
        <ToolTitle
          icon={<Terminal className="h-4 w-4" />}
          label="Bash"
          params={<SkeletonValue value={input?.description} width="150px" />}
          stats={output ? `${outputLines} ${outputLines === 1 ? 'line' : 'lines'}` : undefined}
        />
        <div className="mt-1 max-w-full">
          <Popover
            content={<div className="max-w-xl whitespace-pre-wrap break-all font-mono text-xs">{command || ''}</div>}
            trigger="hover">
            {tagContent}
          </Popover>
        </div>
      </>
    ),
    children: output ? (
      <div className="whitespace-pre-line">{output}</div>
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
