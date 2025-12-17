import { loggerService } from '@logger'

import type { ActionGroup, MenuAction } from '../types'

const logger = loggerService.withContext('FormattingActions')

/**
 * 格式化操作集合
 */
export const formattingActions: MenuAction[] = [
  {
    id: 'format-color',
    label: 'Color',
    group: 'format' as ActionGroup,
    isEnabled: () => true, // 颜色选择总是可用
    execute: (_editor, node, pos) => {
      try {
        logger.debug('Color picker action - placeholder', { nodeType: node.type.name, pos })
        // TODO: 实现颜色选择器功能
        // 这里先提供一个占位实现
      } catch (error) {
        logger.error('Failed to open color picker', error as Error)
        throw error
      }
    }
  },

  {
    id: 'format-reset',
    label: 'Clear Formatting',
    group: 'format' as ActionGroup,
    isEnabled: (editor) => {
      return editor.can().unsetAllMarks()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Clearing formatting', { nodeType: node.type.name, pos })

        // 选择整个节点内容
        const from = pos + 1 // 节点内容开始位置
        const to = pos + node.nodeSize - 1 // 节点内容结束位置

        // 清除所有格式标记
        editor.chain().focus().setTextSelection({ from, to }).unsetAllMarks().run()

        logger.debug('Formatting cleared successfully')
      } catch (error) {
        logger.error('Failed to clear formatting', error as Error)
        throw error
      }
    }
  }

  // 注意：更多格式化操作可以在后续版本中添加
]
