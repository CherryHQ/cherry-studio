/**
 * Open MinerU Document Processor
 *
 * API-based document processor using self-hosted MinerU service.
 * Converts PDFs to markdown format.
 */

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import FormData from 'form-data'
import * as fs from 'fs'
import * as path from 'path'

import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('OpenMineruProcessor')

const MAX_RETRIES = 5
const RETRY_INTERVAL_MS = 5000

export class OpenMineruProcessor extends BaseMarkdownConverter {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'open-mineru')
    if (!template) {
      throw new Error('Open MinerU processor template not found in presets')
    }
    super(template)
  }

  private async uploadAndExtractMarkdown(
    apiHost: string,
    apiKey: string | undefined,
    file: FileMetadata,
    context: ProcessingContext
  ): Promise<string> {
    const endpoint = `${apiHost}/file_parse`
    const filePath = fileStorage.getFilePathById(file)
    const fileBuffer = await fs.promises.readFile(filePath)

    const formData = new FormData()
    formData.append('return_md', 'true')
    formData.append('response_format_zip', 'true')
    formData.append('files', fileBuffer, {
      filename: file.name
    })

    let retries = 0
    let zipPath: string | undefined

    while (retries < MAX_RETRIES) {
      this.checkCancellation(context)

      try {
        const headers: Record<string, string> = {
          ...formData.getHeaders()
        }

        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const response = await net.fetch(endpoint, {
          method: 'POST',
          headers,
          body: new Uint8Array(formData.getBuffer())
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type')
        if (contentType !== 'application/zip') {
          throw new Error(`Unexpected content-type: ${contentType}`)
        }

        zipPath = path.join(this.storageDir, `${file.id}.zip`)
        const extractPath = path.join(this.storageDir, file.id)

        const arrayBuffer = await response.arrayBuffer()
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))
        logger.info(`Downloaded ZIP file: ${zipPath}`)

        if (!fs.existsSync(extractPath)) {
          fs.mkdirSync(extractPath, { recursive: true })
        }

        const zip = new AdmZip(zipPath)
        zip.extractAllTo(extractPath, true)
        logger.info(`Extracted files to: ${extractPath}`)

        if (zipPath && fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath)
        }

        const fileOutputPath = path.join(extractPath, file.id)
        const files = fs.readdirSync(fileOutputPath)
        const mdFile = files.find((f) => f.endsWith('.md'))

        if (!mdFile) {
          throw new Error('No markdown file found in extraction output')
        }

        return path.join(fileOutputPath, mdFile)
      } catch (error) {
        logger.warn(`Failed to upload and extract: ${(error as Error).message}, retry ${retries + 1}/${MAX_RETRIES}`)

        if (zipPath && fs.existsSync(zipPath)) {
          try {
            fs.unlinkSync(zipPath)
          } catch (cleanupError) {
            logger.warn('Failed to cleanup zip file during retry', {
              zipPath,
              fileId: file.id,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            })
          }
        }

        if (retries === MAX_RETRIES - 1) {
          throw error
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS))
    }

    throw new Error(`Processing timeout for file: ${file.id}`)
  }

  async convertToMarkdown(
    file: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    await this.validateFile(file)
    this.checkCancellation(context)

    const apiHost = this.getApiHost(config)
    const apiKey = this.getApiKey(config)

    const filePath = fileStorage.getFilePathById(file)
    logger.info(`Open MinerU processing started: ${filePath}`)

    logger.info(`File ${file.name} is starting processing...`)

    const markdownPath = await this.uploadAndExtractMarkdown(apiHost, apiKey, file, context)
    this.checkCancellation(context)

    return {
      markdownPath
    }
  }
}
