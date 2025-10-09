import { AccordionItem } from '@heroui/react'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ToolTitle } from './GenericTools'

interface UnknownToolProps {
  toolName: string
  input?: unknown
  output?: unknown
}

export function UnknownToolRenderer({ toolName = '', input, output }: UnknownToolProps) {
  const { highlightCode } = useCodeStyle()
  const [inputHtml, setInputHtml] = useState<string>('')
  const [outputHtml, setOutputHtml] = useState<string>('')

  useEffect(() => {
    if (input !== undefined) {
      const inputStr = JSON.stringify(input, null, 2)
      highlightCode(inputStr, 'json').then(setInputHtml)
    }
  }, [input, highlightCode])

  useEffect(() => {
    if (output !== undefined) {
      const outputStr = JSON.stringify(output, null, 2)
      highlightCode(outputStr, 'json').then(setOutputHtml)
    }
  }, [output, highlightCode])

  const getToolDisplayName = (name: string) => {
    if (name.startsWith('mcp__')) {
      const parts = name.substring(5).split('__')
      if (parts.length >= 2) {
        return `${parts[0]}:${parts.slice(1).join(':')}`
      }
    }
    return name
  }

  const getToolDescription = () => {
    if (toolName.startsWith('mcp__')) {
      return 'MCP Server Tool'
    }
    return 'Tool'
  }

  return (
    <AccordionItem
      key="unknown-tool"
      aria-label={toolName}
      title={
        <ToolTitle
          icon={<Wrench className="h-4 w-4" />}
          label={getToolDisplayName(toolName)}
          params={getToolDescription()}
        />
      }>
      <div className="space-y-3">
        {input !== undefined && (
          <div>
            <div className="mb-1 font-semibold text-foreground-600 text-xs dark:text-foreground-400">Input:</div>
            <div
              className="overflow-x-auto rounded bg-gray-50 dark:bg-gray-900"
              dangerouslySetInnerHTML={{ __html: inputHtml }}
            />
          </div>
        )}

        {output !== undefined && (
          <div>
            <div className="mb-1 font-semibold text-foreground-600 text-xs dark:text-foreground-400">Output:</div>
            <div
              className="rounded bg-gray-50 dark:bg-gray-900 [&>*]:whitespace-pre-line"
              dangerouslySetInnerHTML={{ __html: outputHtml }}
            />
          </div>
        )}

        {input === undefined && output === undefined && (
          <div className="text-foreground-500 text-xs">No data available for this tool</div>
        )}
      </div>
    </AccordionItem>
  )
}
