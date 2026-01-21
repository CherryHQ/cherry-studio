import type { CollapseProps } from 'antd'
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
  const command = input?.command

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Terminal className="h-4 w-4" />}
        label="Bash"
        params={<SkeletonValue value={input?.description} width="150px" />}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Command 输入区域 */}
        {command && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">Command</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2">
              <code className="whitespace-pre-wrap break-all font-mono text-xs">{command}</code>
            </div>
          </div>
        )}

        {/* Output 输出区域 */}
        {output ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">Output</div>
            <div className="max-h-60 overflow-y-auto rounded-md bg-muted/30 p-2">
              <pre className="whitespace-pre-wrap font-mono text-xs">{output}</pre>
            </div>
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}
