import { Client } from '@notionhq/client'

/**
 * 扁平化导出深层嵌套的 Notion 块
 */
export class NotionBlockExporter {
  private notion: Client

  constructor(notion: Client) {
    this.notion = notion
  }

  /**
   * 将块分批并使用扁平化方式导出
   */
  public async exportBlocks(allBlocks: any[], targetPageId: string): Promise<void> {
    try {
      // 1. 扁平化所有块
      const flatBlocks = this.flattenBlocks(allBlocks)

      // 2. 分批添加块
      const BATCH_SIZE = 100
      for (let i = 0; i < flatBlocks.length; i += BATCH_SIZE) {
        const batch = flatBlocks.slice(i, i + BATCH_SIZE)
        await this.notion.blocks.children.append({
          block_id: targetPageId,
          children: batch
        })

        // 添加延迟以避免速率限制
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // 3. 重新组织层级关系（简化版本）
      await this.reorganizeHierarchy()
    } catch (error: any) {
      if (error.status === 429) {
        // 处理速率限制
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return this.exportBlocks(allBlocks, targetPageId)
      }
      throw error
    }
  }

  /**
   * 将嵌套的块结构扁平化
   */
  private flattenBlocks(blocks: any[], level: number = 0): any[] {
    const flatBlocks: any[] = []

    for (const block of blocks) {
      // 创建一个副本
      const flatBlock = { ...block }

      // 获取子块数组，可能在不同位置
      let children: any[] = []
      let hasChildren = false

      if (block.children) {
        children = block.children
        hasChildren = true
      } else if (block[block.type]?.children) {
        children = block[block.type].children
        hasChildren = true
      }

      // 如果超过两层嵌套，将 children 转换为普通文本
      if (level >= 2 && hasChildren) {
        const childrenText = this.extractTextFromChildren(children)
        if (childrenText) {
          // 将 children 的内容添加到当前块的文本中
          if (flatBlock.type === 'paragraph' && flatBlock.paragraph?.rich_text) {
            flatBlock.paragraph.rich_text.push({
              type: 'text',
              text: {
                content: '\n' + childrenText
              }
            })
          } else if (flatBlock.type === 'bulleted_list_item' && flatBlock.bulleted_list_item?.rich_text) {
            flatBlock.bulleted_list_item.rich_text.push({
              type: 'text',
              text: {
                content: '\n' + childrenText
              }
            })
          } else if (flatBlock.type === 'numbered_list_item' && flatBlock.numbered_list_item?.rich_text) {
            flatBlock.numbered_list_item.rich_text.push({
              type: 'text',
              text: {
                content: '\n' + childrenText
              }
            })
          }
        }

        // 移除嵌套的 children
        if (block.children) {
          delete flatBlock.children
        } else if (flatBlock[flatBlock.type]?.children) {
          delete flatBlock[flatBlock.type].children
        }
      } else if (hasChildren && children.length > 0) {
        // 保留两层内的嵌套
        const flattenedChildren = this.flattenBlocks(children, level + 1)
        if (block.children) {
          flatBlock.children = flattenedChildren
        } else if (flatBlock[flatBlock.type]) {
          flatBlock[flatBlock.type].children = flattenedChildren
        }
      }

      flatBlocks.push(flatBlock)
    }

    return flatBlocks
  }

  /**
   * 从子块中提取文本内容
   */
  private extractTextFromChildren(children: any[]): string {
    let text = ''
    for (const child of children) {
      if (child.type === 'paragraph' && child.paragraph?.rich_text) {
        text += child.paragraph.rich_text.map((rt: any) => rt.text?.content || '').join('')
      } else if (child.type === 'bulleted_list_item' && child.bulleted_list_item?.rich_text) {
        text += '• ' + child.bulleted_list_item.rich_text.map((rt: any) => rt.text?.content || '').join('')
      } else if (child.type === 'numbered_list_item' && child.numbered_list_item?.rich_text) {
        text += '- ' + child.numbered_list_item.rich_text.map((rt: any) => rt.text?.content || '').join('')
      } else if (child.type === 'to_do' && child.to_do?.rich_text) {
        text += '☐ ' + child.to_do.rich_text.map((rt: any) => rt.text?.content || '').join('')
      }

      // 递归处理子块的子元素
      let childChildren: any[] = []
      if (child.children) {
        childChildren = child.children
      } else if (child[child.type]?.children) {
        childChildren = child[child.type].children
      }

      if (childChildren && childChildren.length > 0) {
        text += '\n' + this.extractTextFromChildren(childChildren)
      }
      text += '\n'
    }
    return text
  }

  /**
   * 重新组织层级关系（简化版本）
   */
  private async reorganizeHierarchy(): Promise<void> {
    // 简化的层级重组，主要确保块的顺序正确
    // 在实际应用中，可以根据需要进一步完善
    return Promise.resolve()
  }
}
