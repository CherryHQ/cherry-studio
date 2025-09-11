import { loggerService } from '@logger'
import { FileText, Plus } from 'lucide-react'
import React from 'react'

import type { ActionGroup, MenuAction } from '../types'

const logger = loggerService.withContext('InsertActions')

/**
 * 插入操作集合
 */
export const insertActions: MenuAction[] = [
  {
    id: 'insert-paragraph-after',
    label: 'Add Paragraph Below',
    icon: React.createElement(Plus, { size: 16 }),
    group: 'insert' as ActionGroup,
    shortcut: 'Enter',
    isEnabled: () => true,
    execute: (editor, node, pos) => {
      try {
        logger.debug('Inserting paragraph after block', { nodeType: node.type.name, pos })

        // 计算插入位置（当前块之后）
        const insertPos = pos + node.nodeSize

        // 插入新段落
        editor
          .chain()
          .focus()
          .insertContentAt(insertPos, '<p></p>')
          .focus(insertPos + 1)
          .run()

        // 延迟触发命令菜单 - 这样用户可以通过 "/" 快速插入其他类型的块
        setTimeout(() => {
          try {
            editor.chain().insertContent('/').run()
            logger.debug('Command menu triggered with "/"')
          } catch (error) {
            logger.warn('Failed to trigger command menu', error as Error)
          }
        }, 50)

        logger.debug('Paragraph inserted successfully')
      } catch (error) {
        logger.error('Failed to insert paragraph', error as Error)
        throw error
      }
    }
  },

  {
    id: 'insert-paragraph-before',
    label: 'Add Paragraph Above',
    icon: React.createElement(FileText, { size: 16 }),
    group: 'insert' as ActionGroup,
    isEnabled: () => true,
    execute: (editor, node, pos) => {
      try {
        logger.debug('Inserting paragraph before block', { nodeType: node.type.name, pos })

        // 插入位置就是当前块的开始位置
        const insertPos = pos

        // 插入新段落
        editor
          .chain()
          .focus()
          .insertContentAt(insertPos, '<p></p>')
          .focus(insertPos + 1)
          .run()

        logger.debug('Paragraph inserted before block successfully')
      } catch (error) {
        logger.error('Failed to insert paragraph before block', error as Error)
        throw error
      }
    }
  }
]
