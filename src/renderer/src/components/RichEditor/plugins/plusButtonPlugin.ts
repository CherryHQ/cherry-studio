import { computePosition, type ComputePositionConfig } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { findElementNextToCoords } from '../helpers/findNextElementFromCursor'
import { getOuterNode, getOuterNodePos } from '../helpers/getOutNode'
import { removeNode } from '../helpers/removeNode'

const getOuterDomNode = (view: EditorView, domNode: HTMLElement) => {
  let tmpDomNode = domNode

  // Traverse to top level node.
  while (tmpDomNode?.parentNode) {
    if (tmpDomNode.parentNode === view.dom) {
      break
    }

    tmpDomNode = tmpDomNode.parentNode as HTMLElement
  }

  return tmpDomNode
}

export const plusButtonPluginDefaultKey = new PluginKey('plusButton')

export interface PlusButtonPluginOptions {
  pluginKey?: PluginKey | string
  editor: Editor
  element: HTMLElement
  insertNodeType?: string
  insertNodeAttrs?: Record<string, any>
  onNodeChange?: (data: { editor: Editor; node: Node | null; pos: number }) => void
  onElementClick?: (event: MouseEvent) => void
  computePositionConfig?: ComputePositionConfig
}

export const PlusButtonPlugin = ({
  pluginKey = plusButtonPluginDefaultKey,
  editor,
  element,
  insertNodeType = 'paragraph',
  insertNodeAttrs = {},
  computePositionConfig,
  onNodeChange,
  onElementClick
}: PlusButtonPluginOptions) => {
  const wrapper = document.createElement('div')
  let currentNode: Node | null = null
  let currentNodePos = -1

  function hideButton() {
    if (!element) {
      return
    }

    element.style.visibility = 'hidden'
    element.style.pointerEvents = 'none'
  }

  function showButton() {
    if (!element) {
      return
    }

    if (!editor.isEditable) {
      hideButton()
      return
    }

    element.style.visibility = ''
    element.style.pointerEvents = 'auto'
  }

  function repositionPlusButton(dom: Element) {
    const virtualElement = {
      getBoundingClientRect: () => dom.getBoundingClientRect()
    }

    computePosition(virtualElement, element, computePositionConfig).then((val) => {
      Object.assign(element.style, {
        position: val.strategy,
        left: `${val.x}px`,
        top: `${val.y}px`
      })
    })
  }

  function onClick(e: MouseEvent) {
    if (currentNodePos === -1) return
    const nodeType = editor.schema.nodes[insertNodeType]
    const insertPos = currentNodePos + currentNode!.nodeSize
    const newNode = nodeType.create(insertNodeAttrs)
    const tr = editor.state.tr.insert(insertPos, newNode)

    // 设置光标位置到新插入的节点内部
    const newNodePos = insertPos + 1 // 进入新节点内部
    tr.setSelection(TextSelection.near(tr.doc.resolve(newNodePos)))

    editor.view.dispatch(tr)
    onElementClick?.(e)
  }

  element.addEventListener('click', onClick)
  wrapper.appendChild(element)
  hideButton()

  return {
    unbind() {
      element.removeEventListener('click', onClick)
    },
    plugin: new Plugin({
      key: typeof pluginKey === 'string' ? new PluginKey(pluginKey) : pluginKey,

      view: (view) => {
        editor.view.dom.parentElement?.appendChild(wrapper)

        wrapper.style.position = 'absolute'
        wrapper.style.top = '0'
        wrapper.style.left = '0'
        wrapper.style.pointerEvents = 'none'
        return {
          update: (_, prevState) => {
            if (!editor.isEditable) {
              hideButton()
              return
            }

            if (view.state.doc.eq(prevState.doc) && currentNodePos !== -1) {
              // 只要鼠标位置没有变化，就不必重新定位
              return
            }
            if (currentNodePos === -1) {
              hideButton()
              onNodeChange?.({ editor, node: null, pos: -1 })
              return
            }
            let domNode = view.nodeDOM(currentNodePos) as HTMLElement
            if (!domNode) return
            domNode = getOuterDomNode(view, domNode)
            if (domNode === view.dom) {
              hideButton()
              onNodeChange?.({ editor, node: null, pos: -1 })
              return
            }
            const outerNodePos = getOuterNodePos(editor.state.doc, view.posAtDOM(domNode, 0))
            const outerNode = getOuterNode(editor.state.doc, outerNodePos)

            // 若外层节点没有变化则不必重复处理
            if (outerNode === currentNode && outerNodePos === currentNodePos) {
              return
            }
            currentNode = outerNode
            currentNodePos = outerNodePos

            repositionPlusButton(domNode as Element)
            showButton()
          },

          destroy: () => {
            removeNode(wrapper)
          }
        }
      },

      props: {
        // Add any additional editor props if needed
        handleDOMEvents: {
          mousemove(view, e) {
            // 当编辑器不可编辑或按钮已被锁定时直接返回
            if (!editor.isEditable) return false

            // 通过坐标向右寻找最近的块级元素
            const result = findElementNextToCoords({
              editor,
              x: e.clientX,
              y: e.clientY,
              direction: 'right'
            })

            if (!result.resultNode || result.pos === null) {
              // 没有匹配到块 → 隐藏按钮
              hideButton()
              currentNode = null
              currentNodePos = -1
              onNodeChange?.({ editor, node: null, pos: -1 })
              return false
            }

            // 取到块对应的 DOM
            let domNode = result.resultElement as HTMLElement
            domNode = getOuterDomNode(view, domNode)

            if (domNode === view.dom || domNode?.nodeType !== 1) {
              hideButton()
              return false
            }

            // 通过 DOM → 文档位置 → 最外层块位置
            const outerPos = getOuterNodePos(editor.state.doc, view.posAtDOM(domNode, 0))
            const outerNode = getOuterNode(editor.state.doc, outerPos)

            // 若目标块未改变直接返回
            if (outerNode === currentNode && outerPos === currentNodePos) {
              return false
            }

            // 更新缓存并回调
            currentNode = outerNode
            currentNodePos = outerPos
            onNodeChange?.({ editor, node: currentNode, pos: currentNodePos })

            // 重新定位按钮并显示
            repositionPlusButton(domNode as Element)
            showButton()

            return false // 继续向下传播其它 mousemove 处理器
          },

          // Hide button when typing/input events occur
          keydown(view) {
            if (view.hasFocus()) {
              hideButton()
              currentNode = null
              currentNodePos = -1
              onNodeChange?.({ editor, node: null, pos: -1 })
              return false
            }
            return false
          },

          scroll(view) {
            if (view.hasFocus()) {
              hideButton()
              currentNode = null
              currentNodePos = -1
              onNodeChange?.({ editor, node: null, pos: -1 })
              return false
            }
            return false
          },

          // 当鼠标离开编辑器区域时隐藏按钮
          mouseleave(_view, e) {
            // 如果指针正好在 wrapper（按钮）上则不隐藏
            if (wrapper.contains(e.relatedTarget as HTMLElement)) return false
            hideButton()
            currentNode = null
            currentNodePos = -1
            onNodeChange?.({ editor, node: null, pos: -1 })
            return false
          }
        }
      }
    })
  }
}
