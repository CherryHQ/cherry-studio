import type { Plugin } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import React from 'react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { defaultComputePositionConfig } from '../extensions/plus-button'
import { PlusButtonPlugin, plusButtonPluginDefaultKey, PlusButtonPluginOptions } from '../plugins/plusButtonPlugin'

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>

export type PlusButtonProps = Omit<Optional<PlusButtonPluginOptions, 'pluginKey'>, 'element'> & {
  className?: string
  onNodeChange?: (data: { node: Node | null; editor: Editor; pos: number }) => void
  children: ReactNode
}

export const PlusButton: React.FC<PlusButtonProps> = (props: PlusButtonProps) => {
  const {
    className = 'plus-button',
    children,
    editor,
    pluginKey = plusButtonPluginDefaultKey,
    onNodeChange,
    onElementClick,
    computePositionConfig = defaultComputePositionConfig
  } = props
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const plugin = useRef<Plugin | null>(null)
  useEffect(() => {
    let initPlugin: {
      plugin: Plugin
      unbind: () => void
    } | null = null

    if (!element) {
      return () => {
        plugin.current = null
      }
    }

    if (editor.isDestroyed) {
      return () => {
        plugin.current = null
      }
    }

    if (!plugin.current) {
      initPlugin = PlusButtonPlugin({
        editor,
        element,
        pluginKey,
        computePositionConfig: {
          ...defaultComputePositionConfig,
          ...computePositionConfig
        },
        onElementClick,
        onNodeChange
      })
      plugin.current = initPlugin.plugin

      editor.registerPlugin(plugin.current)
    }
    return () => {
      editor.unregisterPlugin(pluginKey)
      plugin.current = null
      if (initPlugin) {
        initPlugin.unbind()
        initPlugin = null
      }
    }
  }, [computePositionConfig, editor, element, onElementClick, onNodeChange, pluginKey])
  return (
    <div className={className} style={{ visibility: 'hidden', position: 'absolute' }} ref={setElement}>
      {children}
    </div>
  )
}

export default PlusButton
