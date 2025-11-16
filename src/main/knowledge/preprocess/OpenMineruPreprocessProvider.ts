import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { fileStorage } from '@main/services/FileStorage'
import type { FileMetadata, PreprocessProvider } from '@types'
import AdmZip from 'adm-zip'
import { net } from 'electron'
import FormData from 'form-data'

import BasePreprocessProvider from './BasePreprocessProvider'

const logger = loggerService.withContext('MineruPreprocessProvider')

export default class OpenMineruPreprocessProvider extends BasePreprocessProvider {
  constructor(provider: PreprocessProvider, userId?: string) {
    super(provider, userId)
  }

  public async parseFile(
    sourceId: string,
    file: FileMetadata
  ): Promise<{ processedFile: FileMetadata; quota: number }> {
    try {
      const filePath = fileStorage.getFilePathById(file)
      logger.info(`Open MinerU preprocess processing started: ${filePath}`)
      await this.validateFile(filePath)

      // 1. Update progress
      await this.sendPreprocessProgress(sourceId, 50)
      logger.info(`File ${file.name} is starting processing...`)

      // 2. Upload file and extract
      const { path: outputPath } = await this.uploadFileAndExtract(file)

      // 3. Check quota
      const quota = await this.checkQuota()

      // 4. Create processed file info
      return {
        processedFile: this.createProcessedFileInfo(file, outputPath),
        quota
      }
    } catch (error) {
      logger.error(`Open MinerU preprocess processing failed for:`, error as Error)
      throw error
    }
  }

  public async checkQuota() {
    // self-hosted version always has enough quota
    return Infinity
  }

  private async validateFile(filePath: string): Promise<void> {
    const pdfBuffer = await fs.promises.readFile(filePath)

    const doc = await this.readPdf(pdfBuffer)

    // File page count must be less than 600 pages
    if (doc.numPages >= 600) {
      throw new Error(`PDF page count (${doc.numPages}) exceeds the limit of 600 pages`)
    }
    // File size must be less than 200MB
    if (pdfBuffer.length >= 200 * 1024 * 1024) {
      const fileSizeMB = Math.round(pdfBuffer.length / (1024 * 1024))
      throw new Error(`PDF file size (${fileSizeMB}MB) exceeds the limit of 200MB`)
    }
  }

  private createProcessedFileInfo(file: FileMetadata, outputPath: string): FileMetadata {
    // Find the main file after extraction
    let finalPath = ''
    let finalName = file.origin_name.replace('.pdf', '.md')
    // Find the corresponding folder by file id
    outputPath = path.join(outputPath, file.id)
    try {
      const files = fs.readdirSync(outputPath)

      const mdFile = files.find((f) => f.endsWith('.md'))
      if (mdFile) {
        const originalMdPath = path.join(outputPath, mdFile)
        const newMdPath = path.join(outputPath, finalName)

        // Rename file to original file name
        try {
          fs.renameSync(originalMdPath, newMdPath)
          finalPath = newMdPath
          logger.info(`Renamed markdown file from ${mdFile} to ${finalName}`)
        } catch (renameError) {
          logger.warn(`Failed to rename file ${mdFile} to ${finalName}: ${renameError}`)
          // If rename fails, use the original file
          finalPath = originalMdPath
          finalName = mdFile
        }
      }
    } catch (error) {
      logger.warn(`Failed to read output directory ${outputPath}:`, error as Error)
      finalPath = path.join(outputPath, `${file.id}.md`)
    }

    return {
      ...file,
      name: finalName,
      path: finalPath,
      ext: '.md',
      size: fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0
    }
  }

  private async uploadFileAndExtract(
    file: FileMetadata,
    maxRetries: number = 5,
    intervalMs: number = 5000
  ): Promise<{ path: string }> {
    let retries = 0

    const endpoint = `${this.provider.apiHost}/file_parse`

    // Get file stream
    const filePath = fileStorage.getFilePathById(file)
    const fileBuffer = await fs.promises.readFile(filePath)

    const formData = new FormData()
    formData.append('return_md', 'true')
    formData.append('response_format_zip', 'true')
    formData.append('files', fileBuffer, {
      filename: file.name
    })

    while (retries < maxRetries) {
      let zipPath: string | undefined

      try {
        const response = await net.fetch(endpoint, {
          method: 'POST',
          headers: {
            token: this.userId ?? '',
            ...(this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
            ...formData.getHeaders()
          },
          body: formData.getBuffer()
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Check if response header is application/zip
        if (response.headers.get('content-type') !== 'application/zip') {
          throw new Error(`Downloaded ZIP file has unexpected content-type: ${response.headers.get('content-type')}`)
        }

        const dirPath = this.storageDir

        zipPath = path.join(dirPath, `${file.id}.zip`)
        const extractPath = path.join(dirPath, `${file.id}`)

        const arrayBuffer = await response.arrayBuffer()
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer))
        logger.info(`Downloaded ZIP file: ${zipPath}`)

        // Ensure extraction directory exists
        if (!fs.existsSync(extractPath)) {
          fs.mkdirSync(extractPath, { recursive: true })
        }

        // Extract files
        const zip = new AdmZip(zipPath)
        zip.extractAllTo(extractPath, true)
        logger.info(`Extracted files to: ${extractPath}`)

        return { path: extractPath }
      } catch (error) {
        logger.warn(
          `Failed to upload and extract file: ${(error as Error).message}, retry ${retries + 1}/${maxRetries}`
        )
        if (retries === maxRetries - 1) {
          throw error
        }
      } finally {
        // Delete temporary ZIP file
        if (zipPath && fs.existsSync(zipPath)) {
          try {
            fs.unlinkSync(zipPath)
            logger.info(`Deleted temporary ZIP file: ${zipPath}`)
          } catch (deleteError) {
            logger.warn(`Failed to delete temporary ZIP file ${zipPath}:`, deleteError as Error)
          }
        }
      }

      retries++
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Processing timeout for file: ${file.id}`)
  }
}
