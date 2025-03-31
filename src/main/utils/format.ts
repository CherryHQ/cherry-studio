import path from 'node:path'

import { ImageArea } from '@cherrystudio/embedjs-interfaces'
import { windowService } from '@main/services/WindowService'
import { FileType } from '@types'
import { ipcMain } from 'electron'
import * as fs from 'fs'

import { findImages } from './markdown'

export async function formatOcrFile(ocrFile: FileType): Promise<FileType> {
  console.log('Formatting OCR file:', ocrFile.name)
  try {
    // --- 1. Read Markdown Content ---
    const originalMarkdown = fs.readFileSync(ocrFile.path, 'utf-8')
    const identifiedImages = await findImages(originalMarkdown)
    if (!identifiedImages || identifiedImages.length === 0) {
      console.log('No images found in the markdown file.')
      return ocrFile
    } else {
      console.log(`Found ${identifiedImages.length} image tags.`)
    }
    const imageDir = path.dirname(ocrFile.path) // Get directory from file path
    const imagePathsToSummarize = identifiedImages
      .map((img) => path.resolve(imageDir, img.url)) // Construct absolute paths
      .filter((p) => fs.existsSync(p)) // Ensure the image file actually exists
    if (imagePathsToSummarize.length === 0 && identifiedImages.length > 0) {
      console.warn('Image tags found, but corresponding image files missing or paths incorrect.')
    }

    let imageSummaries = new Map<string, string>()
    if (imagePathsToSummarize.length > 0) {
      imageSummaries = await getImageSummary(imagePathsToSummarize)
      console.log('Image summaries received:', Object.fromEntries(imageSummaries))
    } else {
      console.log('No valid image paths found to summarize.')
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
    console.log('Processed markdown written to file:', ocrFile.path)
  } catch (error) {
    console.error(`Error processing file ${ocrFile.name}:`, error)
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

  // 将单个路径转换为数组以统一处理
  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths]

  // 为每个图片创建Promise
  const summaryPromises = paths.map((imgPath) => {
    // 从路径中提取图片ID
    const imgId = imgPath.split('/').pop()?.split('.')[0] || ''

    return new Promise<[string, string]>((resolve) => {
      // 发送请求到渲染进程
      mainWindow.webContents.send('knowledge-image-summary', {
        imagePath: imgPath,
        imageId: imgId
      })

      // 创建一次性监听器
      const replyHandler = (_, { response, imageId: responseImageId }) => {
        if (responseImageId === imgId) {
          ipcMain.removeListener('knowledge-image-summary-reply', replyHandler)
          resolve([imgId, response])
        }
      }

      ipcMain.on('knowledge-image-summary-reply', replyHandler)

      // 添加超时处理
      setTimeout(() => {
        ipcMain.removeListener('knowledge-image-summary-reply', replyHandler)
        resolve([imgId, 'to be summarized']) // 替换为默认响应而不是reject
      }, 200000) // 200s
    })
  })

  // 使用Promise.all获取所有结果，并构建Map
  const results = await Promise.all(summaryPromises)
  return new Map(results)
}
