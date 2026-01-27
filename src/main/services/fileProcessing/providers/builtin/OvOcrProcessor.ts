/**
 * OpenVINO OCR Processor
 *
 * Batch-based OCR processor using Intel OpenVINO.
 * Only available on Windows with Intel CPU (Ultra series).
 */

import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { type FileProcessorMerged, PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import { exec } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

import { BaseTextExtractor } from '../../base/BaseTextExtractor'
import type { ProcessingContext } from '../../types'

const logger = loggerService.withContext('OvOcrProcessor')
const execAsync = promisify(exec)

// Path to the OV OCR batch file
const PATH_BAT_FILE = path.join(os.homedir(), HOME_CHERRY_DIR, 'ovms', 'ovocr', 'run.npu.bat')

// Timeout for batch execution (60 seconds)
const BATCH_TIMEOUT_MS = 60000

/**
 * OpenVINO OCR processor
 *
 * Uses Intel OpenVINO for OCR on Intel Ultra CPUs.
 * Processes images through a batch script that interfaces with the NPU.
 */
export class OvOcrProcessor extends BaseTextExtractor {
  constructor() {
    const template = PRESETS_FILE_PROCESSORS.find((p) => p.id === 'ovocr')
    if (!template) {
      throw new Error('OV OCR processor template not found in presets')
    }
    super(template)
  }

  /**
   * Check if the processor is available
   *
   * Requirements:
   * - Windows OS
   * - Intel Ultra CPU
   * - run.npu.bat exists
   */
  async isAvailable(): Promise<boolean> {
    if (!isWin) {
      return false
    }

    if (!this.isIntelUltraCpu()) {
      return false
    }

    return fs.existsSync(PATH_BAT_FILE)
  }

  /**
   * Check if the CPU is an Intel Ultra series
   */
  private isIntelUltraCpu(): boolean {
    const cpuModel = os.cpus()[0]?.model.toLowerCase() ?? ''
    return cpuModel.includes('intel') && cpuModel.includes('ultra')
  }

  /**
   * Get the OV OCR directory path
   */
  private getOvOcrPath(): string {
    return path.join(os.homedir(), HOME_CHERRY_DIR, 'ovms', 'ovocr')
  }

  /**
   * Get the input image directory path
   */
  private getImgDir(): string {
    return path.join(this.getOvOcrPath(), 'img')
  }

  /**
   * Get the output directory path
   */
  private getOutputDir(): string {
    return path.join(this.getOvOcrPath(), 'output')
  }

  /**
   * Clear a directory recursively
   */
  private async clearDirectory(dirPath: string): Promise<void> {
    await fs.promises.rm(dirPath, { recursive: true, force: true })
    await fs.promises.mkdir(dirPath, { recursive: true })
  }

  /**
   * Copy a file to the image directory
   */
  private async copyFileToImgDir(sourceFilePath: string, targetFileName: string): Promise<void> {
    const imgDir = this.getImgDir()
    const targetFilePath = path.join(imgDir, targetFileName)
    await fs.promises.copyFile(sourceFilePath, targetFilePath)
  }

  /**
   * Execute the OCR batch script
   */
  private async runOcrBatch(): Promise<void> {
    const ovOcrPath = this.getOvOcrPath()

    try {
      await execAsync(`"${PATH_BAT_FILE}"`, {
        cwd: ovOcrPath,
        timeout: BATCH_TIMEOUT_MS
      })
    } catch (error) {
      logger.error('Error running OV OCR batch', { error })
      throw new Error(`Failed to run OCR batch: ${error}`)
    }
  }

  /**
   * Perform text extraction using OpenVINO OCR
   */
  async extractText(
    input: FileMetadata,
    _config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    if (!isImageFileMetadata(input)) {
      throw new Error('OvOcrProcessor only supports image files')
    }

    logger.info('Processing file', { path: input.path })

    // Check availability
    const available = await this.isAvailable()
    if (!available) {
      throw new Error('OV OCR is not available on this system (requires Windows + Intel Ultra CPU)')
    }

    try {
      // 1. Clear input and output directories
      await this.clearDirectory(this.getImgDir())
      await this.clearDirectory(this.getOutputDir())

      // 2. Copy file to img directory
      const fileName = path.basename(input.path)
      await this.copyFileToImgDir(input.path, fileName)
      logger.debug('File copied to img directory', { fileName })

      // Check cancellation before batch execution
      this.checkCancellation(context)

      // 3. Run batch script
      logger.debug('Running OV OCR batch process')
      await this.runOcrBatch()

      // 4. Check output file exists
      const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
      const outputFilePath = path.join(this.getOutputDir(), `${baseNameWithoutExt}.txt`)

      if (!fs.existsSync(outputFilePath)) {
        throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
      }

      // 5. Read result
      const ocrText = await fs.promises.readFile(outputFilePath, 'utf-8')
      logger.debug('OCR text extracted', { preview: ocrText.substring(0, 100) })

      return { text: ocrText }
    } catch (error) {
      logger.error('Error during OV OCR process', { error })
      throw error
    }
  }
}
