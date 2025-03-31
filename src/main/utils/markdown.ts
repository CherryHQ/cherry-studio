import { ImageArea } from '@cherrystudio/embedjs-interfaces'
import { Node } from 'unist'

// 假设这些接口定义在同一个文件或已导入
export interface ImageNode extends Node {
  // 确保 ImageNode 继承 Node
  type: 'image'
  title?: null | string // title 可以是 string
  alt: string
  url: string
  position?: {
    // position 是可选的，但我们逻辑中需要它
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
}
export interface HtmlNode extends Node {
  // 定义 HTML 节点类型
  type: 'html'
  value: string
  position?: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
}

export async function findImages(markdownContent: string) {
  // 使用动态导入
  const remarkParse = await import('remark-parse')
  const { unified } = await import('unified')
  const { visit } = await import('unist-util-visit')
  const processor = unified().use(remarkParse.default)

  const parseTree = processor.parse(markdownContent)
  const tree = await processor.run(parseTree)

  const images: ImageArea[] = []

  visit(tree, 'image', (node: ImageNode) => {
    // node.position 包含 start 和 end 对象，每个对象有 line, column, offset
    // offset (字符索引) 通常最适合用于后续的文本操作和范围比较
    if (node.url && node.position) {
      images.push({
        url: node.url,
        areaPosition: {
          startOffset: node.position.start.offset,
          endOffset: node.position.end.offset
        }
      })
    }
  })
  console.log('images', images)
  return images

  // console.dir(tree, { depth: null })
}

export async function mapImageAreas(markdownContent: string, imageDir: string): Promise<ImageArea[]> {
  // 参数类型检查
  if (typeof markdownContent !== 'string') {
    throw new TypeError('markdownContent must be a string')
  }

  // 使用动态导入
  const remarkParse = await import('remark-parse')
  const { unified } = await import('unified')
  const { visit } = await import('unist-util-visit')
  const processor = unified().use(remarkParse.default)
  const tree = processor.parse(markdownContent) // 直接使用 parse 的结果即可
  const imageAreas: ImageArea[] = []
  visit(tree, 'image', (node, index, parent) => {
    // 基本验证：确保节点有效，有位置信息，并且在父节点内有索引
    if (!node.url || !node.position || index === null || index === undefined || !parent || !parent.children) {
      console.warn('Skipping image node due to missing data or context:', node)
      return // 跳过无效节点
    }
    const imagePath = `${imageDir}/${node.url}` // 传递相对路径
    const imageStartOffset = node.position.start.offset
    // 默认结束位置是图片标签自身结束的位置
    let areaEndOffset = node.position.end.offset
    // 检查图片节点之后，在同一个父节点（通常是 paragraph）内的兄弟节点
    for (let j = index + 1; j < parent.children.length; j++) {
      const sibling = parent.children[j] as Node // 类型断言为 Node
      // 检查是否是包含 '</image-description>' 的 HTML 节点
      // 做更安全的检查，确保 sibling 有 position 和 value
      if (
        sibling.type === 'html' &&
        (sibling as HtmlNode).value && // 确保 value 存在
        typeof (sibling as HtmlNode).value === 'string' && // 确保 value 是字符串
        (sibling as HtmlNode).value.trim() === '</image-description>' &&
        (sibling as HtmlNode).position // 确保 position 存在
      ) {
        // 找到了描述的结束标签，更新区域的结束偏移量
        areaEndOffset = (sibling as HtmlNode).position!.end.offset // 使用 ! 断言 position 存在
        console.log(`Found closing tag for ${imagePath}, updating area end offset to ${areaEndOffset}`)
        // 找到后即可停止查找该图片的结束标签
        break
      }
    }
    if (areaEndOffset === node.position.end.offset) {
      console.log(
        `No closing description tag found immediately after ${imagePath} within the same parent. Area ends at image tag.`
      )
    }
    // 添加识别出的区域（可能是单独的图片，或图片+描述）
    imageAreas.push({
      url: imagePath,
      areaPosition: {
        startOffset: imageStartOffset ?? 0, // 提供默认值 0 以防 undefined
        endOffset: areaEndOffset ?? 0 // 使用最终确定的结束偏移量，提供默认值
      }
    })
  })
  console.log('Mapped Image Areas:', imageAreas)
  return imageAreas
}
