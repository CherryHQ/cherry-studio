import fs from 'node:fs'

import { MistralClientManager } from '@main/services/MistralClientManager'
import { MistralService } from '@main/services/remotefile/MistralService'
import { Mistral } from '@mistralai/mistralai'
import { DocumentURLChunk } from '@mistralai/mistralai/models/components/documenturlchunk'
import { ImageURLChunk } from '@mistralai/mistralai/models/components/imageurlchunk'
import { OCRResponse } from '@mistralai/mistralai/models/components/ocrresponse'
import { FileMetadata, FileTypes, PreprocessProvider, Provider } from '@types'
import Logger from 'electron-log'
import path from 'path'

import BasePreprocessProvider from './BasePreprocessProvider'

type PreuploadResponse = DocumentURLChunk | ImageURLChunk

export default class MistralPreprocessProvider extends BasePreprocessProvider {
  private sdk: Mistral
  private fileService: MistralService

  constructor(provider: PreprocessProvider) {
    super(provider)
    const clientManager = MistralClientManager.getInstance()
    const aiProvider: Provider = {
      id: provider.id,
      type: 'mistral',
      name: provider.name,
      apiKey: provider.apiKey!,
      apiHost: provider.apiHost!,
      models: []
    }
    clientManager.initializeClient(aiProvider)
    this.sdk = clientManager.getClient()
    this.fileService = new MistralService(aiProvider)
  }

  private async preupload(file: FileMetadata): Promise<PreuploadResponse> {
    let document: PreuploadResponse
    Logger.info(`preprocess preupload started for local file: ${file.path}`)

    if (file.ext.toLowerCase() === '.pdf') {
      const uploadResponse = await this.fileService.uploadFile(file)

      if (uploadResponse.status === 'failed') {
        Logger.error('File upload failed:', uploadResponse)
        throw new Error('Failed to upload file: ' + uploadResponse.displayName)
      }
      await this.sendPreprocessProgress(file.id, 15)
      const fileUrl = await this.sdk.files.getSignedUrl({
        fileId: uploadResponse.fileId
      })
      Logger.info('Got signed URL:', fileUrl)
      await this.sendPreprocessProgress(file.id, 20)
      document = {
        type: 'document_url',
        documentUrl: fileUrl.url
      }
    } else {
      const base64Image = Buffer.from(fs.readFileSync(file.path)).toString('base64')
      document = {
        type: 'image_url',
        imageUrl: `data:image/png;base64,${base64Image}`
      }
    }

    if (!document) {
      throw new Error('Unsupported file type')
    }
    return document
  }

  public async parseFile(sourceId: string, file: FileMetadata): Promise<{ processedFile: FileMetadata }> {
    try {
      const document = await this.preupload(file)
      const result = await this.sdk.ocr.process({
        model: this.provider.model!,
        document: document,
        includeImageBase64: true
      })
      if (result) {
        await this.sendPreprocessProgress(sourceId, 100)
        const processedFile = this.convertFile(result, file)
        return {
          processedFile
        }
      } else {
        throw new Error('preprocess processing failed: OCR response is empty')
      }
    } catch (error) {
      throw new Error('preprocess processing failed: ' + error)
    }
  }

  private convertFile(result: OCRResponse, file: FileMetadata): FileMetadata {
    // 使用统一的存储路径：Data/Files/{file.id}/
    const conversionId = file.id
    const outputPath = path.join(this.storageDir, file.id)
    // const outputPath = this.storageDir
    const outputFileName = path.basename(file.path, path.extname(file.path))
    fs.mkdirSync(outputPath, { recursive: true })

    const markdownParts: string[] = []
    let counter = 0

    // Process each page
    result.pages.forEach((page) => {
      let pageMarkdown = page.markdown

      // Process images from this page
      page.images.forEach((image) => {
        if (image.imageBase64) {
          let imageFormat = 'jpeg' // default format
          let imageBase64Data = image.imageBase64

          // Check for data URL prefix more efficiently
          const prefixEnd = image.imageBase64.indexOf(';base64,')
          if (prefixEnd > 0) {
            const prefix = image.imageBase64.substring(0, prefixEnd)
            const formatIndex = prefix.indexOf('image/')
            if (formatIndex >= 0) {
              imageFormat = prefix.substring(formatIndex + 6)
            }
            imageBase64Data = image.imageBase64.substring(prefixEnd + 8)
          }

          const imageFileName = `img-${counter}.${imageFormat}`
          const imagePath = path.join(outputPath, imageFileName)

          // Save image file
          try {
            fs.writeFileSync(imagePath, Buffer.from(imageBase64Data, 'base64'))

            // Update image reference in markdown
            // Use relative path for better portability
            const relativeImagePath = `./${imageFileName}`

            // Find the start and end of the image markdown
            const imgStart = pageMarkdown.indexOf(image.imageBase64)
            if (imgStart >= 0) {
              // Find the markdown image syntax around this base64
              const mdStart = pageMarkdown.lastIndexOf('![', imgStart)
              const mdEnd = pageMarkdown.indexOf(')', imgStart)

              if (mdStart >= 0 && mdEnd >= 0) {
                // Replace just this specific image reference
                pageMarkdown =
                  pageMarkdown.substring(0, mdStart) +
                  `![Image ${counter}](${relativeImagePath})` +
                  pageMarkdown.substring(mdEnd + 1)
              }
            }

            counter++
          } catch (error) {
            Logger.error(`Failed to save image ${imageFileName}:`, error)
          }
        }
      })

      markdownParts.push(pageMarkdown)
    })

    // Combine all markdown content with double newlines for readability
    const combinedMarkdown = markdownParts.join('\n\n')

    // Write the markdown content to a file
    const mdFileName = `${outputFileName}.md`
    const mdFilePath = path.join(outputPath, mdFileName)
    fs.writeFileSync(mdFilePath, combinedMarkdown)

    return {
      id: conversionId,
      name: file.name.replace(/\.[^/.]+$/, '.md'),
      origin_name: file.origin_name,
      path: mdFilePath,
      created_at: new Date().toISOString(),
      type: FileTypes.DOCUMENT,
      ext: '.md',
      size: fs.statSync(mdFilePath).size,
      count: 1
    } as FileMetadata
  }

  public checkQuota(): Promise<number> {
    throw new Error('Method not implemented.')
  }
}
