import { ImageArea } from '@main/loader/markdownLoader'
import { windowService } from '@main/services/WindowService'
import { FileMetadata } from '@types'
import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import path from 'path'
import { Node } from 'unist'

export interface ImageNode extends Node {
  type: 'image'
  title?: null | string
  alt: string
  url: string
  position?: {
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
  console.log('[Enhance Knowledge processFile]: Found images', images)
  return images
}

export async function mapImageAreas(markdownContent: string, imageDir: string): Promise<ImageArea[]> {
  // 参数类型检查
  if (typeof markdownContent !== 'string') {
    throw new TypeError('markdownContent must be a string')
  }

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

export async function formatOcrFile(ocrFile: FileMetadata): Promise<FileMetadata> {
  const storageDir = path.join(app.getPath('userData'), 'Data', 'Files')
  try {
    // --- 1. Read Markdown Content ---
    const originalMarkdown = fs.readFileSync(ocrFile.path, 'utf-8')
    const identifiedImages = await findImages(originalMarkdown)
    if (!identifiedImages || identifiedImages.length === 0) {
      console.log('[Enhance Knowledge processFile]: No images found in the markdown file.')
      return ocrFile
    } else {
      console.log(`[Enhance Knowledge processFile]: Found ${identifiedImages.length} image tags.`)
    }
    const imageDir = ocrFile.id
    const imagePathsToSummarize = identifiedImages
      .map((img) => path.join(imageDir, img.url)) // Construct absolute paths
      .filter((p) => fs.existsSync(path.join(storageDir, p))) // Ensure the image file actually exists
    if (imagePathsToSummarize.length === 0 && identifiedImages.length > 0) {
      console.warn(
        '[Enhance Knowledge processFile]: Image tags found, but corresponding image files missing or paths incorrect.'
      )
    }

    let imageSummaries = new Map<string, string>()
    if (imagePathsToSummarize.length > 0) {
      imageSummaries = await getImageSummary(imagePathsToSummarize)
      console.log(
        '[Enhance Knowledge processFile]: Summarized images:',
        JSON.stringify(Array.from(imageSummaries.entries()))
      )
    } else {
      console.log('[Enhance Knowledge processFile]: No valid image paths found to summarize.')
    }

    // --- 4. Insert Image Descriptions into Markdown ---
    const processedMarkdown = insertImageDescription(originalMarkdown, identifiedImages, imageSummaries)
    // --- 5. What to do with processedMarkdown? ---
    // Option A: Log it for now (as requested implicitly)
    console.log('\n--- Processed Markdown (first 500 chars) ---')
    console.log(processedMarkdown.substring(0, 500) + '...')
    console.log('---------------------------------------------\n')
    // write the processed markdown to a file
    fs.writeFileSync(ocrFile.path, processedMarkdown, 'utf-8')
    console.log('[Enhance Knowledge processFile]: Processed markdown written to file:', ocrFile.path)
  } catch (error) {
    console.error(`[Enhance Knowledge processFile]: Error processing file ${ocrFile.name}:`, error)
  }

  return ocrFile
}

export function insertImageDescription(
  originalMarkdown: string,
  images: ImageArea[],
  summaries: Map<string, string> // Key: basename (e.g., 'image.jpg'), Value: summary text
): string {
  // Filter out images without valid positions (shouldn't happen often with remark)
  const validImages = images.filter(
    (img) => img.areaPosition.startOffset !== undefined && img.areaPosition.endOffset !== undefined
  ) as Array<Required<ImageArea>> // Type assertion after filtering
  // Sort images by their END offset in DESCENDING order
  // This is crucial for inserting without messing up subsequent offsets
  validImages.sort((a, b) => b.areaPosition.endOffset - a.areaPosition.endOffset)
  let modifiedMarkdown = originalMarkdown
  for (const img of validImages) {
    const imageName = path.basename(img.url.split('.')[0]) // Extract 'image.jpg' from 'images/image.jpg'
    const summary = summaries.get(imageName)
    if (summary) {
      // Construct the description string. Add newlines for better separation.
      const descriptionString = `\n<image-description>${summary}</image-description>\n`
      const insertPos = img.areaPosition.endOffset // Insert right after the image markdown tag ends
      // Perform the insertion using string slicing
      modifiedMarkdown = modifiedMarkdown.slice(0, insertPos) + descriptionString + modifiedMarkdown.slice(insertPos)
      console.log(`Inserted description for image ${imageName} at position ${insertPos}. Summary: ${summary}`)
    } else {
      console.warn(`Summary not found for image: ${imageName}`)
      // Decide how to handle missing summaries: skip, add a placeholder, etc.
      // Skipping for now.
    }
  }
  return modifiedMarkdown
}

export async function getImageSummary(imagePaths: string | string[]): Promise<Map<string, string>> {
  const mainWindow = windowService.getMainWindow()

  if (!mainWindow) {
    throw new Error('主窗口不可用')
  }

  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths]

  const summaryPromises = paths.map((imgPath) => {
    const imgId = imgPath.split('/').pop()?.split('.')[0] || ''

    return new Promise<[string, string]>((resolve) => {
      const replyChannel = 'knowledge-image-summary-reply'
      let timeoutId: NodeJS.Timeout | null = null

      const replyHandler = (_, { response, imageId: responseImageId }) => {
        if (responseImageId === imgId) {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          ipcMain.removeListener(replyChannel, replyHandler) // 移除此特定监听器
          resolve([imgId, response])
        }
      }

      // 使用 ipcMain.on
      ipcMain.on(replyChannel, replyHandler)

      timeoutId = setTimeout(() => {
        ipcMain.removeListener(replyChannel, replyHandler) // 超时后移除监听器
        resolve([imgId, 'to be summarized'])
        timeoutId = null
      }, 200000) // 200s

      // 发送请求到渲染进程
      mainWindow.webContents.send('knowledge-image-summary', {
        imagePath: imgPath,
        imageId: imgId
      })
    })
  })

  const results = await Promise.all(summaryPromises)
  return new Map(results)
}
