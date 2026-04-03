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
import { useCallback, useRef, useState } from 'react'

const MIN_INPUT_WIDTH = 32
const INPUT_PADDING = 8

function measureTextWidth(text: string, font: string): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return MIN_INPUT_WIDTH
  ctx.font = font
  return Math.ceil(ctx.measureText(text).width)
}

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
  const inputRef = useRef<HTMLInputElement>(null)

  const getInputFont = useCallback(() => {
    const el = inputRef.current
    if (!el) return '14px sans-serif'
    const style = window.getComputedStyle(el)
    return `${style.fontSize} ${style.fontFamily}`
  }, [])

  const displayText = value || placeholder || variableKey
  const inputWidth = Math.max(MIN_INPUT_WIDTH, measureTextWidth(displayText, getInputFont()) + INPUT_PADDING)

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
          ref={inputRef}
          className="mx-0.5 inline h-auto rounded-none border-0 border-b border-dashed border-foreground/30 bg-transparent px-0.5 py-0 text-foreground shadow-none outline-none transition-colors focus-visible:border-solid focus-visible:border-primary focus-visible:ring-0"
          style={{ lineHeight: 'inherit', fontSize: 'inherit', width: inputWidth }}
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
            className="mx-0.5 inline-flex h-auto w-auto min-w-16 gap-0.5 rounded-sm border-0 bg-secondary px-1.5 py-0 shadow-none hover:bg-primary/10"
            style={{ lineHeight: 'inherit', fontSize: 'inherit' }}
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
