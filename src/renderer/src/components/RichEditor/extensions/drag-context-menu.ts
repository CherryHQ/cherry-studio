// import type { Editor } from '@tiptap/core'

// import type { Node } from '@tiptap/pm/model'

// import { allActions } from '../components/dragContextMenu/actions'

// // 全局状态存储
// let currentEditor: Editor | null = null
// let currentMenuElement: HTMLElement | null = null
// let isMenuVisible = false

/**
 * 创建上下文菜单
 */
// function createContextMenu(editor: Editor, node: Node, position: number): HTMLElement {
//   const menu = document.createElement('div')
//   menu.className = 'drag-context-menu'
//   menu.style.cssText = `
//     position: fixed;
//     background: var(--color-bg-base);
//     border: 1px solid var(--color-border);
//     border-radius: 8px;
//     box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.04);
//     padding: 8px 0;
//     min-width: 240px;
//     max-width: 320px;
//     z-index: 2000;
//     opacity: 0;
//     transform: translateY(-8px);
//     transition: all 0.2s ease;
//     font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
//   `

//   // 获取适用于当前节点的操作
//   const availableActions = allActions.filter((action) => action.isEnabled(editor, node, position))

//   logger.debug('Available actions', {
//     total: allActions.length,
//     available: availableActions.length,
//     nodeType: node.type.name,
//     actions: availableActions.map((a) => a.id)
//   })

//   // 按组分类操作 - 重新组织为符合参考图的结构
//   const actionGroups = {
//     format: availableActions.filter((a) => a.group === 'format'),
//     turnInto: availableActions.filter((a) => a.group === 'transform'),
//     actions: availableActions.filter((a) => a.group === 'block' || a.group === 'insert')
//   }

//   // 渲染操作组 - 使用参考图中的标签
//   const groupLabels = {
//     format: '', // 格式化组不显示标题
//     turnInto: 'Turn Into',
//     actions: '' // actions 组不显示标题，直接显示操作
//   }

//   Object.entries(actionGroups).forEach(([groupKey, actions]) => {
//     if (actions.length === 0) return

//     const group = groupKey as keyof typeof actionGroups

//     // 组标题和分隔线
//     if (menu.children.length > 0) {
//       const divider = document.createElement('div')
//       divider.style.cssText = 'height: 1px; background: var(--color-border-secondary); margin: 8px 0;'
//       menu.appendChild(divider)
//     }

//     // 只为有标题的组显示标题
//     if (groupLabels[group]) {
//       const groupTitle = document.createElement('div')
//       groupTitle.textContent = groupLabels[group]
//       groupTitle.style.cssText = `
//         padding: 8px 16px 4px;
//         font-size: 13px;
//         font-weight: 500;
//         color: var(--color-text-2);
//         margin-bottom: 4px;
//       `
//       menu.appendChild(groupTitle)
//     }

//     // 操作项
//     actions.forEach((action) => {
//       const item = document.createElement('button')
//       item.className = 'menu-item'
//       item.style.cssText = `
//         width: 100%;
//         display: flex;
//         align-items: center;
//         padding: 10px 16px;
//         border: none;
//         background: transparent;
//         color: ${action.danger ? 'var(--color-error)' : 'var(--color-text)'};
//         font-size: 14px;
//         text-align: left;
//         cursor: pointer;
//         transition: background-color 0.15s ease;
//         gap: 12px;
//         border-radius: 6px;
//         margin: 0 4px;
//       `

//       // 图标映射
//       const getIconSvg = (actionId: string) => {
//         const iconMap: Record<string, string> = {
//           'format-color':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="11.5" r=".5"/><circle cx="12.5" cy="13.5" r=".5"/><circle cx="13.5" cy="17.5" r=".5"/><circle cx="10.5" cy="16.5" r=".5"/><circle cx="15.5" cy="14.5" r=".5"/><circle cx="9.5" cy="12.5" r=".5"/><circle cx="7.5" cy="15.5" r=".5"/><circle cx="11.5" cy="18.5" r=".5"/><circle cx="14.5" cy="20.5" r=".5"/></svg>',
//           'format-reset':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
//           'transform-heading-1':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l10 10.5 6-6.5"/><path d="M14 7h7"/></svg>',
//           'transform-heading-2':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l10 10.5 6-6.5"/><path d="M14 7h7"/></svg>',
//           'transform-heading-3':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l10 10.5 6-6.5"/><path d="M14 7h7"/></svg>',
//           'transform-paragraph':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,7 4,4 20,4 20,7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
//           'transform-bullet-list':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
//           'transform-ordered-list':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
//           'transform-blockquote':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
//           'transform-code-block':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></svg>',
//           'block-copy':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
//           'block-duplicate':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M16 12l-4 4-4-4"/></svg>',
//           'block-delete':
//             '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
//         }
//         return iconMap[actionId] || ''
//       }

//       // 图标、标签和右箭头（Turn Into 组需要箭头）
//       const showArrow = group === 'turnInto'
//       const iconSvg = getIconSvg(action.id)
//       const content = `
//         ${iconSvg ? '<span class="menu-icon" style="width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">' + iconSvg + '</span>' : ''}
//         <span style="flex: 1; font-weight: 400;">${action.label}</span>
//         ${showArrow ? '<span style="width: 16px; height: 16px; flex-shrink: 0; opacity: 0.5;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></span>' : ''}
//       `
//       item.innerHTML = content

//       // 悬停效果
//       item.addEventListener('mouseenter', () => {
//         item.style.background = action.danger ? 'var(--color-error-bg)' : 'var(--color-hover)'
//       })
//       item.addEventListener('mouseleave', () => {
//         item.style.background = 'transparent'
//       })

//       // 点击处理
//       item.addEventListener('click', (e) => {
//         e.preventDefault()
//         e.stopPropagation()

//         try {
//           action.execute(editor, node, position)
//           hideContextMenu()
//           logger.debug('Action executed', { actionId: action.id })
//         } catch (error) {
//           logger.error('Failed to execute action', error as Error)
//           hideContextMenu()
//         }
//       })

//       menu.appendChild(item)
//     })
//   })

//   // 如果没有任何操作，添加一个提示
//   if (menu.children.length === 0) {
//     const emptyItem = document.createElement('div')
//     emptyItem.textContent = 'No actions available'
//     emptyItem.style.cssText = `
//       padding: 12px 16px;
//       color: var(--color-text-3);
//       font-style: italic;
//       text-align: center;
//     `
//     menu.appendChild(emptyItem)
//   }

//   logger.debug('Context menu created', {
//     childrenCount: menu.children.length,
//     hasActions: availableActions.length > 0
//   })

//   return menu
// }

/**
 * 显示上下文菜单
 */

// function showContextMenu(editor: Editor, node: Node, position: number, clientX: number, clientY: number) {
//   logger.debug('showContextMenu called', {
//     nodeType: node.type.name,
//     position,
//     clientX,
//     clientY
//   })

//   hideContextMenu() // 先隐藏现有菜单

//   currentEditor = editor
//   currentMenuElement = createContextMenu(editor, node, position)

//   // 添加到 body
//   document.body.appendChild(currentMenuElement)

//   // 计算位置
//   const rect = currentMenuElement.getBoundingClientRect()
//   let x = clientX + 10
//   let y = clientY

//   // 边界检测
//   if (x + rect.width > window.innerWidth) {
//     x = clientX - rect.width - 10
//   }
//   if (y + rect.height > window.innerHeight) {
//     y = window.innerHeight - rect.height - 10
//   }

//   currentMenuElement.style.left = `${x}px`
//   currentMenuElement.style.top = `${y}px`

//   // 显示动画
//   requestAnimationFrame(() => {
//     if (currentMenuElement) {
//       currentMenuElement.style.opacity = '1'
//       currentMenuElement.style.transform = 'translateY(0)'
//       isMenuVisible = true
//     }
//   })

//   // 全局点击关闭
//   const handleClickOutside = (e: MouseEvent) => {
//     if (currentMenuElement && !currentMenuElement.contains(e.target as HTMLElement)) {
//       hideContextMenu()
//     }
//   }

//   // ESC 键关闭
//   const handleEscape = (e: KeyboardEvent) => {
//     if (e.key === 'Escape') {
//       hideContextMenu()
//     }
//   }

//   setTimeout(() => {
//     document.addEventListener('click', handleClickOutside)
//     document.addEventListener('keydown', handleEscape)
//   }, 0)
// }

/**
 * 隐藏上下文菜单
 */
// function hideContextMenu() {
//   if (currentMenuElement && isMenuVisible) {
//     currentMenuElement.style.opacity = '0'
//     currentMenuElement.style.transform = 'translateY(-10px)'

//     setTimeout(() => {
//       if (currentMenuElement && document.body.contains(currentMenuElement)) {
//         document.body.removeChild(currentMenuElement)
//       }
//       currentMenuElement = null
//       currentEditor = null
//       isMenuVisible = false
//     }, 150)

//     // 移除事件监听器
//     document.removeEventListener('click', () => {})
//     document.removeEventListener('keydown', () => {})
//   }
// }

// /**
//  * 拖拽上下文菜单扩展
//  */
// export const DragContextMenuExtension = DragHandle.extend({
//   name: 'dragContextMenu',

//   addOptions() {
//     return {
//       render: () => {
//         // 创建拖拽手柄容器
//         const wrapper = document.createElement('div')
//         wrapper.className = 'drag-handle-wrapper'
//         wrapper.style.cssText = `
//           display: flex;
//           align-items: center;
//           gap: 0.25rem;
//           opacity: 0;
//           transition: opacity 0.15s ease;
//           z-index: 10;
//         `

//         // 加号按钮 - 使用React组件和ProseMirror plugin
//         let plusButtonElement: HTMLElement | null = null

//         // 拖拽手柄
//         const dragHandle = document.createElement('div')
//         dragHandle.className = 'drag-handle'
//         dragHandle.innerHTML = `
//           <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
//             <circle cx="9" cy="12" r="1" fill="currentColor"/>
//             <circle cx="15" cy="12" r="1" fill="currentColor"/>
//             <circle cx="9" cy="6" r="1" fill="currentColor"/>
//             <circle cx="15" cy="6" r="1" fill="currentColor"/>
//             <circle cx="9" cy="18" r="1" fill="currentColor"/>
//             <circle cx="15" cy="18" r="1" fill="currentColor"/>
//           </svg>
//         `
//         dragHandle.style.cssText = `
//           display: flex;
//           align-items: center;
//           justify-content: center;
//           width: 1.5rem;
//           height: 1.5rem;
//           border-radius: 0.25rem;
//           background: var(--color-background);
//           color: var(--color-text-3);
//           cursor: grab;
//           transition: background 0.15s ease;
//           pointer-events: auto;
//           user-select: none;
//         `

//         // 悬停效果
//         const addHoverEffect = (element: HTMLElement) => {
//           element.addEventListener('mouseenter', () => {
//             element.style.background = 'var(--color-hover)'
//           })
//           element.addEventListener('mouseleave', () => {
//             element.style.background = 'var(--color-background)'
//           })
//         }

//         addHoverEffect(dragHandle)

//         // 显示/隐藏逻辑
//         const showControls = () => {
//           wrapper.style.opacity = '1'
//         }
//         const hideControls = () => {
//           wrapper.style.opacity = '0'
//         }

//         // 点击事件 - 显示上下文菜单
//         // dragHandle.addEventListener('click', (e) => {
//         //   e.preventDefault()
//         //   e.stopPropagation()

//         //   logger.debug('Drag handle clicked', {
//         //     currentEditor: !!currentEditor,
//         //     parentElement: !!wrapper.parentElement,
//         //     grandParent: !!wrapper.parentElement?.parentElement
//         //   })

//         //   // 获取与此拖拽手柄相关的节点
//         //   if (currentEditor && wrapper.parentElement) {
//         //     try {
//         //       // 找到关联的块级元素
//         //       const blockElement = wrapper.parentElement.parentElement
//         //       if (blockElement) {
//         //         logger.debug('Found block element', {
//         //           tagName: blockElement.tagName,
//         //           className: blockElement.className
//         //         })

//         //         const pos = currentEditor.view.posAtDOM(blockElement, 0)
//         //         logger.debug('Position from DOM', { pos })

//         //         // 检查位置是否有效
//         //         if (pos < 0) {
//         //           logger.warn('Invalid position from DOM, using selection position')
//         //           // 使用当前选择位置作为后备
//         //           const selectionPos = currentEditor.state.selection.from
//         //           const resolvedPos = currentEditor.state.doc.resolve(selectionPos)
//         //           const node = resolvedPos.parent

//         //           showContextMenu(currentEditor, node, selectionPos, e.clientX, e.clientY)
//         //           return
//         //         }

//         //         const resolvedPos = currentEditor.state.doc.resolve(pos)

//         //         logger.debug('Position info', {
//         //           pos,
//         //           depth: resolvedPos.depth,
//         //           parentType: resolvedPos.parent.type.name
//         //         })

//         //         // 找到块级节点
//         //         let node = resolvedPos.parent
//         //         let nodePos = pos

//         //         for (let depth = resolvedPos.depth; depth >= 0; depth--) {
//         //           const nodeAtDepth = resolvedPos.node(depth)
//         //           if (nodeAtDepth.isBlock && depth > 0) {
//         //             node = nodeAtDepth
//         //             nodePos = resolvedPos.start(depth)
//         //             break
//         //           }
//         //         }

//         //         logger.debug('Showing context menu', {
//         //           nodeType: node.type.name,
//         //           nodePos,
//         //           clientX: e.clientX,
//         //           clientY: e.clientY
//         //         })

//         //         showContextMenu(currentEditor, node, nodePos, e.clientX, e.clientY)
//         //       } else {
//         //         logger.warn('Block element not found')
//         //       }
//         //     } catch (error) {
//         //       logger.error('Failed to show context menu', error as Error)
//         //     }
//         //   } else {
//         //     logger.warn('Missing editor or parent element', {
//         //       hasEditor: !!currentEditor,
//         //       hasParent: !!wrapper.parentElement
//         //     })
//         //   }
//         // })

//         // 设置块级悬停监听器
//         setTimeout(() => {
//           const blockElement = wrapper.parentElement?.parentElement
//           if (blockElement) {
//             blockElement.addEventListener('mouseenter', showControls)
//             blockElement.addEventListener('mouseleave', () => {
//               hideControls()
//               cleanup()
//             })
//           }
//         }, 0)

//         // 只添加 drag handle，plus button 会在 showControls 中动态创建
//         wrapper.appendChild(dragHandle)

//         return wrapper
//       }
//       // onNodeChange: ({ editor }) => {
//       //   currentEditor = editor
//       //   logger.debug('onNodeChange - editor set', { hasEditor: !!editor })
//       // }
//     }
//   }
// })

// export default DragContextMenuExtension
