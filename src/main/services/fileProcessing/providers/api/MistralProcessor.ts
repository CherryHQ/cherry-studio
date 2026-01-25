/**
 * Mistral Document Processor
 *
 * API-based document processor using Mistral OCR service.
 * Converts PDFs and images to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { MistralClientManager } from '@main/services/MistralClientManager'
import { MistralService } from '@main/services/remotefile/MistralService'
import type { Mistral } from '@mistralai/mistralai'
import type { DocumentURLChunk } from '@mistralai/mistralai/models/components/documenturlchunk'
import type { ImageURLChunk } from '@mistralai/mistralai/models/components/imageurlchunk'
import type { OCRResponse } from '@mistralai/mistralai/models/components/ocrresponse'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata, Provider } from '@types'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('MistralProcessor')

type PreuploadResponse = DocumentURLChunk | ImageURLChunk

export class MistralProcessor extends BaseMarkdownConverter {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'mistral')
    if (!template) {
      throw new Error('Mistral processor template not found in presets')
    }
    super(template)
  }

  /**
   * Get the model ID from configuration
   *
   * After merging, capability.modelId contains the effective value
   * (template default overridden by user config if present)
   */
  private getModelId(config: FileProcessorMerged): string {
    const capability = config.capabilities.find((cap) => cap.feature === 'to_markdown')
    if (capability?.modelId) {
      return capability.modelId
    }

    throw new Error(`Model ID is required for ${this.id} processor`)
  }

  private createClient(config: FileProcessorMerged): { sdk: Mistral; fileService: MistralService } {
    const apiKey = this.getApiKey(config)!
    const apiHost = this.getApiHost(config)

    const provider: Provider = {
      id: 'mistral',
      type: 'mistral',
      name: 'Mistral',
      apiKey,
      apiHost,
      models: []
    }

    const clientManager = MistralClientManager.getInstance()
    clientManager.initializeClient(provider)

    return {
      sdk: clientManager.getClient(),
      fileService: new MistralService(provider)
    }
  }

  private async prepareDocument(
    file: FileMetadata,
    sdk: Mistral,
    fileService: MistralService,
    context: ProcessingContext
  ): Promise<PreuploadResponse> {
    const filePath = fileStorage.getFilePathById(file)
    logger.info(`Preparing document for OCR: ${filePath}`)

    if (file.ext.toLowerCase() === '.pdf') {
      await this.validatePdf(filePath)
      const uploadResponse = await fileService.uploadFile(file)

      if (uploadResponse.status === 'failed') {
        throw new Error(`Failed to upload file: ${uploadResponse.displayName}`)
      }

      this.checkCancellation(context)

      const fileUrl = await sdk.files.getSignedUrl({
        fileId: uploadResponse.fileId
      })

      return {
        type: 'document_url',
        documentUrl: fileUrl.url
      }
    }

    const base64Image = Buffer.from(fs.readFileSync(filePath)).toString('base64')
    return {
      type: 'image_url',
      imageUrl: `data:image/png;base64,${base64Image}`
    }
  }

  private async validatePdf(filePath: string): Promise<void> {
    const { maxFileSizeMb, maxPageCount } = this.getDocumentLimits()

    if (maxFileSizeMb === undefined && maxPageCount === undefined) {
      return
    }

    const stats = await fs.promises.stat(filePath)
    const fileSizeBytes = stats.size

    if (maxFileSizeMb !== undefined && fileSizeBytes > maxFileSizeMb * 1024 * 1024) {
      const fileSizeMB = Math.round(fileSizeBytes / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of ${maxFileSizeMb}MB`)
    }

    if (maxPageCount === undefined) {
      return
    }

    const pdfBuffer = await fs.promises.readFile(filePath)
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true })
    const numPages = pdfDoc.getPageCount()

    if (numPages > maxPageCount) {
      throw new Error(`PDF page count (${numPages}) exceeds the limit of ${maxPageCount} pages`)
    }
  }

  private processOcrResponse(result: OCRResponse, file: FileMetadata): { markdown: string; outputPath: string } {
    const outputPath = path.join(this.storageDir, file.id)
    fs.mkdirSync(outputPath, { recursive: true })

    const markdownParts: string[] = []
    let imageCounter = 0

    for (const page of result.pages) {
      let pageMarkdown = page.markdown

      for (const image of page.images) {
        if (!image.imageBase64) {
          continue
        }

        let imageFormat = 'jpeg'
        let imageBase64Data = image.imageBase64

        const prefixEnd = image.imageBase64.indexOf(';base64,')
        if (prefixEnd > 0) {
          const prefix = image.imageBase64.substring(0, prefixEnd)
          const formatIndex = prefix.indexOf('image/')
          if (formatIndex >= 0) {
            imageFormat = prefix.substring(formatIndex + 6)
          }
          imageBase64Data = image.imageBase64.substring(prefixEnd + 8)
        }

        const imageFileName = `img-${imageCounter}.${imageFormat}`
        const imagePath = path.join(outputPath, imageFileName)

        try {
          fs.writeFileSync(imagePath, Buffer.from(imageBase64Data, 'base64'))

          const relativeImagePath = `./${imageFileName}`
          const imgStart = pageMarkdown.indexOf(image.imageBase64)

          if (imgStart >= 0) {
            const mdStart = pageMarkdown.lastIndexOf('![', imgStart)
            const mdEnd = pageMarkdown.indexOf(')', imgStart)

            if (mdStart >= 0 && mdEnd >= 0) {
              pageMarkdown =
                pageMarkdown.substring(0, mdStart) +
                `![Image ${imageCounter}](${relativeImagePath})` +
                pageMarkdown.substring(mdEnd + 1)
            }
          }

          imageCounter++
        } catch (error) {
          logger.error(`Failed to save image ${imageFileName}:`, error as Error)
        }
      }

      markdownParts.push(pageMarkdown)
    }

    const combinedMarkdown = markdownParts.join('\n\n')

    const baseName = path.basename(fileStorage.getFilePathById(file), path.extname(file.path))
    const mdFileName = `${baseName}.md`
    const mdFilePath = path.join(outputPath, mdFileName)
    fs.writeFileSync(mdFilePath, combinedMarkdown)

    return { markdown: combinedMarkdown, outputPath: mdFilePath }
  }

  protected async doConvert(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    const modelId = this.getModelId(config)
    const { sdk, fileService } = this.createClient(config)

    logger.info(`Mistral processing started for: ${input.path}`)

    const document = await this.prepareDocument(input, sdk, fileService, context)
    this.checkCancellation(context)

    const result = await sdk.ocr.process({
      model: modelId,
      document: document,
      includeImageBase64: true
    })

    if (!result) {
      throw new Error('OCR processing failed: response is empty')
    }

    const { markdown, outputPath } = this.processOcrResponse(result, input)

    return {
      markdown,
      outputPath,
      metadata: {
        model: modelId,
        pageCount: result.pages.length
      }
    }
  }
}
