import { useTranslation } from 'react-i18next'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { ToolStatusIndicator } from './shared/GenericTools'
import { ToolDisclosure } from './shared/ToolDisclosure'

export function MessageCodeExecution({ toolResponse }: { toolResponse: NormalToolResponse }) {
  const { t } = useTranslation()
  const { arguments: input, response, status, toolCallId } = toolResponse
  return (
    <ToolDisclosure
      items={[
        {
          key: toolCallId,
          label: (
            <span className="flex items-center gap-2">
              {t('chat.input.native_code_execution')}
              <ToolStatusIndicator status={status} hasError={status === 'error'} />
            </span>
          ),
          children: (
            <div className="space-y-2">
              <pre className="overflow-auto whitespace-pre-wrap">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
              {response !== undefined && (
                <pre className="overflow-auto whitespace-pre-wrap">
                  {typeof response === 'string' ? response : JSON.stringify(response, null, 2)}
                </pre>
              )}
            </div>
          )
        }
      ]}
    />
  )
}
