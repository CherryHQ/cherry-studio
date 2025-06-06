import { ImageArea } from '@main/loader/markdownLoader'
import { windowService } from '@main/services/WindowService'
import { FileMetadata } from '@types'
import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import path from 'path'
import { Node } from 'unist'
import { v4 as uuidv4 } from 'uuid'

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
  return images
}

function isClosingDescriptionTagNode(node: Node): node is HtmlNode & { position: Required<Node['position']> } {
  if (node.type !== 'html' || !node.position) {
    return false
  }
  return (node as HtmlNode).value.trim() === '</image-description>'
}

export async function findImageDescriptionArea(markdownContent: string, imageDir: string): Promise<ImageArea[]> {
  const remarkParse = await import('remark-parse')
  const { unified } = await import('unified')
  const { visit } = await import('unist-util-visit')
  const processor = unified().use(remarkParse.default)
  const tree = processor.parse(markdownContent)
  const imageAreas: ImageArea[] = []

  visit(tree, 'image', (node, index, parent) => {
    if (
      !node.url ||
      !node.position ||
      !node.position.start.offset ||
      !node.position.end.offset ||
      index === null ||
      index === undefined ||
      !parent ||
      !parent.children
    ) {
      return // 跳过无效节点
    }

    const imagePath = `${imageDir}/${node.url}` // 传递相对路径
    const imageStartOffset = node.position.start.offset
    let areaEndOffset = node.position.end.offset
    for (let j = index + 1; j < parent.children.length; j++) {
      const sibling = parent.children[j]
      if (isClosingDescriptionTagNode(sibling) && sibling.position) {
        areaEndOffset = sibling.position.end.offset
        break
      }
    }

    imageAreas.push({
      url: imagePath,
      areaPosition: {
        startOffset: imageStartOffset,
        endOffset: areaEndOffset
      }
    })
  })
  return imageAreas
}

export async function formatOcrFile(ocrFile: FileMetadata): Promise<FileMetadata> {
  const storageDir = path.join(app.getPath('userData'), 'Data', 'Files')
  try {
    // --- 1. Read Markdown Content ---
    const originalMarkdown = fs.readFileSync(ocrFile.path, 'utf-8')
    const identifiedImages = await findImages(originalMarkdown)
    if (!identifiedImages || identifiedImages.length === 0) {
      return ocrFile
    }
    const imageDir = ocrFile.id
    const imagePathsToSummarize = identifiedImages
      .map((img) => path.join(imageDir, img.url)) // Construct absolute paths
      .filter((p) => fs.existsSync(path.join(storageDir, p))) // Ensure the image file actually exists
    if (imagePathsToSummarize.length === 0 && identifiedImages.length > 0) {
      return ocrFile
    }

    let imageSummaries = new Map<string, string>()
    if (imagePathsToSummarize.length > 0) {
      imageSummaries = await getImageSummary(imagePathsToSummarize)
    } else {
      return ocrFile
    }

    // --- 4. Insert Image Descriptions into Markdown ---
    const processedMarkdown = insertImageDescription(originalMarkdown, identifiedImages, imageSummaries)
    // --- 5. Write the processed markdown to a file ---
    fs.writeFileSync(ocrFile.path, processedMarkdown, 'utf-8')
  } catch (error) {
    console.error(`[Enhance Knowledge processFile]: Error processing file ${ocrFile.name}:`, error)
  }

  return ocrFile
}

export function insertImageDescription(
  originalMarkdown: string,
  images: ImageArea[],
  summaries: Map<string, string>
): string {
  const validImages = images.filter(
    (img) => img.areaPosition.startOffset !== undefined && img.areaPosition.endOffset !== undefined
  ) as Array<Required<ImageArea>>
  // 倒序插入image-description标签，以避免插入时影响后续图片的偏移位置
  validImages.sort((a, b) => b.areaPosition.endOffset - a.areaPosition.endOffset)
  let modifiedMarkdown = originalMarkdown
  for (const img of validImages) {
    const imageName = path.basename(img.url.split('.')[0])
    const summary = summaries.get(imageName)
    if (summary) {
      const descriptionString = `\n<image-description>${summary}</image-description>\n`
      const insertPos = img.areaPosition.endOffset
      modifiedMarkdown = modifiedMarkdown.slice(0, insertPos) + descriptionString + modifiedMarkdown.slice(insertPos)
    }
  }
  return modifiedMarkdown
}

export async function getImageSummary(imagePaths: string[]): Promise<Map<string, string>> {
  const mainWindow = windowService.getMainWindow()
  if (!mainWindow) {
    throw new Error('主窗口不可用')
  }

  if (!imagePaths || imagePaths.length === 0) {
    return new Map()
  }

  const batchId = uuidv4()
  const replyChannel = `knowledge-image-summary-batch-reply-${batchId}`
  const summaries = new Map<string, string>()

  return new Promise<Map<string, string>>((resolve) => {
    let timeoutId: NodeJS.Timeout | null = null

    const replyHandler = (
      _event,
      {
        batchId: responseBatchId,
        results
      }: { batchId: string; results: Array<{ imageId: string; summary: string; error?: string }> }
    ) => {
      if (responseBatchId === batchId) {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        ipcMain.removeListener(replyChannel, replyHandler)
        for (const result of results) {
          if (result.error) {
            summaries.set(result.imageId, '')
          } else {
            summaries.set(result.imageId, result.summary)
          }
        }
        resolve(summaries)
      }
    }

    ipcMain.once(replyChannel, replyHandler)

    const imageRequests = imagePaths.map((imgPath) => {
      const imageId = path.basename(imgPath).split('.')[0] || '' // Ensure consistent imageId generation
      return { imagePath: imgPath, imageId }
    })

    mainWindow.webContents.send('knowledge-image-summary-batch', {
      batchId,
      requests: imageRequests
    })

    // Set a timeout for the entire batch operation
    // Example: 2 minutes base + 5 seconds per image
    const batchTimeoutDuration = 120000 + imagePaths.length * 5000
    timeoutId = setTimeout(() => {
      ipcMain.removeListener(replyChannel, replyHandler)
      imageRequests.forEach((req) => {
        if (!summaries.has(req.imageId)) {
          summaries.set(req.imageId, 'summary batch timeout')
        }
      })
      console.warn(`Image summary batch ${batchId} timed out after ${batchTimeoutDuration}ms.`)
      resolve(summaries)
    }, batchTimeoutDuration)
  })
}
