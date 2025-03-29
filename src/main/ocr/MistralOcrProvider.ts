import fs from 'node:fs'

import { MistralService } from '@main/services/file/MistralService'
import { MistralClientManager } from '@main/services/MistralClientManager'
import { Mistral } from '@mistralai/mistralai'
import { DocumentURLChunk } from '@mistralai/mistralai/models/components/documenturlchunk'
import { ImageURLChunk } from '@mistralai/mistralai/models/components/imageurlchunk'
import { OCRResponse } from '@mistralai/mistralai/models/components/ocrresponse'
import { FileSource, FileTypes, isLocalFile, LocalFileSource, OcrProvider } from '@types'
import Logger from 'electron-log'
import path from 'path'

import BaseOcrProvider from './BaseOcrProvider'

type PreuploadResponse = DocumentURLChunk | ImageURLChunk

export default class MistralOcrProvider extends BaseOcrProvider {
  private sdk: Mistral
  private fileService: MistralService

  constructor(provider: OcrProvider) {
    super(provider)
    const clientManager = MistralClientManager.getInstance()
    clientManager.initializeClient(provider.apiKey!)
    this.sdk = clientManager.getClient()
    this.fileService = new MistralService(provider.apiKey!)
  }

  private async preupload(file: FileSource): Promise<PreuploadResponse> {
    let document: PreuploadResponse
    if (isLocalFile(file)) {
      Logger.info(`OCR preupload started for local file: ${file.path}`)

      if (file.ext.toLowerCase() === '.pdf') {
        const uploadResponse = await this.fileService.uploadFile(file)

        if (uploadResponse.status === 'failed') {
          Logger.error('File upload failed:', uploadResponse)
          throw new Error('Failed to upload file: ' + uploadResponse.displayName)
        }
        await this.sendOcrProgress(file.id, 15)
        const fileUrl = await this.sdk.files.getSignedUrl({
          fileId: uploadResponse.fileId
        })
        Logger.info('Got signed URL:', fileUrl)
        await this.sendOcrProgress(file.id, 20)
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
    } else {
      if (file.ext.toLowerCase() === '.pdf') {
        document = {
          type: 'document_url',
          documentUrl: file.url
        }
      } else {
        document = {
          type: 'image_url',
          imageUrl: file.url
        }
      }
    }

    if (!document) {
      throw new Error('Unsupported file type')
    }
    return document
  }

  public async parseFile(sourceId: string, file: FileSource): Promise<{ processedFile: LocalFileSource }> {
    try {
      const document = await this.preupload(file)
      const result = await this.sdk.ocr.process({
        model: this.provider.model!,
        document: document,
        includeImageBase64: true
      })
      if (result) {
        await this.sendOcrProgress(sourceId, 100)
        const processedFile = this.convertFile(result, file)
        return {
          processedFile
        }
      } else {
        throw new Error('OCR processing failed: OCR response is empty')
      }
    } catch (error) {
      throw new Error('OCR processing failed: ' + error)
    }
  }

  private convertFile(result: OCRResponse, file: FileSource): LocalFileSource {
    // Create a unique directory for this conversion to store images
    const conversionId = file.id
    let outputPath = ''
    let outputFileName = ''
    if (isLocalFile(file)) {
      outputPath = path.join(path.dirname(file.path), conversionId)
      outputFileName = path.basename(file.path, path.extname(file.path))
      fs.mkdirSync(outputPath, { recursive: true })
    }

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
      origin_name: (file as LocalFileSource).origin_name,
      path: mdFilePath,
      created_at: new Date().toISOString(),
      type: FileTypes.DOCUMENT,
      ext: '.md',
      size: fs.statSync(mdFilePath).size,
      count: result.pages.length,
      source: 'local'
    } as LocalFileSource
  }
}
