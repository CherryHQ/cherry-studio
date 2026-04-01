/**
 * React NodeView for PromptVariableNode.
 *
 * Renders inline Input or Select components inside the TipTap editor.
 * The component is an atom node — text cursor skips over it,
 * but the internal Input/Select is fully interactive.
 */

import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'

/** z-index above antd Modal (1000) for Select dropdown portals */
const SELECT_CONTENT_CLASS = 'z-[2000]'

const PromptVariableNodeView: FC<ReactNodeViewProps> = ({ node, updateAttributes }) => {
  const {
    variableKey,
    variableType,
    options: optionsJson,
    placeholder,
    defaultValue
  } = node.attrs as {
    variableKey: string
    variableType: 'input' | 'select'
    options: string
    placeholder: string
    defaultValue: string
  }

  const [value, setValue] = useState(defaultValue || '')

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setValue(newValue)
      updateAttributes({ currentValue: newValue })
    },
    [updateAttributes]
  )

  const handleSelectChange = useCallback(
    (newValue: string) => {
      setValue(newValue)
      updateAttributes({ currentValue: newValue })
    },
    [updateAttributes]
  )

  const parsedOptions: string[] = (() => {
    try {
      return JSON.parse(optionsJson)
    } catch {
      return []
    }
  })()

  return (
    <NodeViewWrapper as="span" className="inline align-middle">
      {variableType === 'input' && (
        <Input
          className="mx-0.5 inline-flex h-7 w-32 text-xs"
          value={value}
          placeholder={placeholder || variableKey}
          onChange={handleInputChange}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      )}
      {variableType === 'select' && (
        <Select value={value} onValueChange={handleSelectChange}>
          <SelectTrigger
            size="sm"
            className="mx-0.5 inline-flex h-7 w-auto min-w-20 text-xs"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}>
            <SelectValue placeholder={variableKey} />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            {parsedOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </NodeViewWrapper>
  )
}

export default PromptVariableNodeView
