import { loggerService } from '@logger'

import type { ActionGroup, MenuAction } from '../types'

const logger = loggerService.withContext('TransformActions')

/**
 * 节点转换操作集合
 */
export const transformActions: MenuAction[] = [
  {
    id: 'transform-heading-1',
    label: 'Heading 1',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().setHeading({ level: 1 })
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to H1', { nodeType: node.type.name, pos })
        editor.chain().focus().setHeading({ level: 1 }).run()
      } catch (error) {
        logger.error('Failed to transform to H1', error as Error)
      }
    }
  },

  {
    id: 'transform-heading-2',
    label: 'Heading 2',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().setHeading({ level: 2 })
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to H2', { nodeType: node.type.name, pos })
        editor.chain().focus().setHeading({ level: 2 }).run()
      } catch (error) {
        logger.error('Failed to transform to H2', error as Error)
      }
    }
  },

  {
    id: 'transform-heading-3',
    label: 'Heading 3',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().setHeading({ level: 3 })
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to H3', { nodeType: node.type.name, pos })
        editor.chain().focus().setHeading({ level: 3 }).run()
      } catch (error) {
        logger.error('Failed to transform to H3', error as Error)
      }
    }
  },

  {
    id: 'transform-paragraph',
    label: 'Text',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return node.type.name === 'heading' && editor.can().setParagraph()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to paragraph', { nodeType: node.type.name, pos })
        editor.chain().focus().setParagraph().run()
      } catch (error) {
        logger.error('Failed to transform to paragraph', error as Error)
      }
    }
  },

  {
    id: 'transform-bullet-list',
    label: 'Bulleted list',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().toggleBulletList()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to bullet list', { nodeType: node.type.name, pos })
        editor.chain().focus().toggleBulletList().run()
      } catch (error) {
        logger.error('Failed to transform to bullet list', error as Error)
      }
    }
  },

  {
    id: 'transform-ordered-list',
    label: 'Numbered list',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().toggleOrderedList()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to ordered list', { nodeType: node.type.name, pos })
        editor.chain().focus().toggleOrderedList().run()
      } catch (error) {
        logger.error('Failed to transform to ordered list', error as Error)
      }
    }
  },

  {
    id: 'transform-blockquote',
    label: 'Quote',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().toggleBlockquote()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to blockquote', { nodeType: node.type.name, pos })
        editor.chain().focus().toggleBlockquote().run()
      } catch (error) {
        logger.error('Failed to transform to blockquote', error as Error)
      }
    }
  },

  {
    id: 'transform-code-block',
    label: 'Code',
    group: 'transform' as ActionGroup,
    isEnabled: (editor, node) => {
      return (node.type.name === 'paragraph' || node.type.name === 'heading') && editor.can().toggleCodeBlock()
    },
    execute: (editor, node, pos) => {
      try {
        logger.debug('Transforming to code block', { nodeType: node.type.name, pos })
        editor.chain().focus().toggleCodeBlock().run()
      } catch (error) {
        logger.error('Failed to transform to code block', error as Error)
      }
    }
  }
]
