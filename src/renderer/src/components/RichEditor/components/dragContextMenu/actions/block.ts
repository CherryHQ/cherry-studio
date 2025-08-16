import { loggerService } from '@logger'

import type { ActionGroup, MenuAction } from '../types'

const logger = loggerService.withContext('BlockActions')

/**
 * 块级操作集合
 */
export const blockActions: MenuAction[] = [
  {
    id: 'block-copy',
    label: 'Copy to clipboard',
    group: 'block' as ActionGroup,
    isEnabled: () => true, // 总是可用
    execute: async (editor, node, pos) => {
      try {
        logger.debug('Copying block', { nodeType: node.type.name, pos })

        // 获取节点的文本内容
        const text = node.textContent

        // 获取节点的 HTML 内容
        const htmlContent = editor.getHTML()

        // 尝试使用现代剪贴板 API
        if (navigator.clipboard && window.ClipboardItem) {
          const clipboardItem = new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([htmlContent], { type: 'text/html' })
          })

          await navigator.clipboard.write([clipboardItem])
          logger.debug('Block copied to clipboard (modern API)')
        } else if (navigator.clipboard) {
          // 后备方案：只复制文本
          await navigator.clipboard.writeText(text)
          logger.debug('Block text copied to clipboard')
        } else {
          // 最后的后备方案：使用传统的复制方法
          const textArea = document.createElement('textarea')
          textArea.value = text
          document.body.appendChild(textArea)
          textArea.select()
          document.execCommand('copy')
          document.body.removeChild(textArea)
          logger.debug('Block copied using legacy method')
        }
      } catch (error) {
        logger.error('Failed to copy block', error as Error)
        throw error
      }
    }
  },

  {
    id: 'block-duplicate',
    label: 'Duplicate node',
    group: 'block' as ActionGroup,
    isEnabled: () => true,
    execute: (editor, node, pos) => {
      try {
        logger.debug('Duplicating block', { nodeType: node.type.name, pos })

        // 计算插入位置（当前块之后）
        const insertPos = pos + node.nodeSize

        // 获取节点的 JSON 表示
        const nodeJson = node.toJSON()

        // 在当前块后插入相同的节点
        editor.chain().focus().insertContentAt(insertPos, nodeJson).run()

        logger.debug('Block duplicated successfully')
      } catch (error) {
        logger.error('Failed to duplicate block', error as Error)
        throw error
      }
    }
  },

  {
    id: 'block-delete',
    label: 'Delete',
    group: 'block' as ActionGroup,
    danger: true,
    isEnabled: (editor, node) => {
      // 检查是否是文档中唯一的块，如果是则不允许删除
      const doc = editor.state.doc
      if (doc.childCount <= 1 && node.type.name === 'paragraph' && !node.textContent.trim()) {
        return false // 不允许删除唯一的空段落
      }
      return true
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Deleting block', { nodeType: node.type.name, pos })

        // 计算删除范围
        const from = pos
        const to = pos + node.nodeSize

        // 删除节点
        editor.chain().focus().deleteRange({ from, to }).run()

        logger.debug('Block deleted successfully')
      } catch (error) {
        logger.error('Failed to delete block', error as Error)
        throw error
      }
    }
  }
]
