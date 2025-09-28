import { loggerService } from '@logger'
import { isWin } from '@main/constant'
import { isImageFileMetadata, OcrOvConfig, OcrResult, SupportedOcrFile } from '@types'
import { exec } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

import { OcrBaseService } from './OcrBaseService'

const logger = loggerService.withContext('OvOcrService')
const execAsync = promisify(exec)

const PATH_BAT_FILE = path.join(os.homedir(), '.cherrystudio', 'ovms', 'ovocr', 'run.npu.bat')

export class OvOcrService extends OcrBaseService {
  constructor() {
    super()
  }

  public isAvalid(): boolean {
    return (
      isWin &&
      os.cpus()[0].model.toLowerCase().includes('intel') &&
      os.cpus()[0].model.toLowerCase().includes('ultra') &&
      fs.existsSync(PATH_BAT_FILE)
    )
  }

  private getOvOcrPath(): string {
    return path.join(os.homedir(), '.cherrystudio', 'ovms', 'ovocr')
  }

  private getImgDir(): string {
    return path.join(this.getOvOcrPath(), 'img')
  }

  private getOutputDir(): string {
    return path.join(this.getOvOcrPath(), 'output')
  }

  private async clearDirectory(dirPath: string): Promise<void> {
    if (fs.existsSync(dirPath)) {
      const files = await fs.promises.readdir(dirPath)
      for (const file of files) {
        const filePath = path.join(dirPath, file)
        const stats = await fs.promises.stat(filePath)
        if (stats.isDirectory()) {
          await this.clearDirectory(filePath)
          await fs.promises.rmdir(filePath)
        } else {
          await fs.promises.unlink(filePath)
        }
      }
    } else {
      // 如果目录不存在，创建它
      await fs.promises.mkdir(dirPath, { recursive: true })
    }
  }

  private async copyFileToImgDir(sourceFilePath: string, targetFileName: string): Promise<void> {
    const imgDir = this.getImgDir()
    const targetFilePath = path.join(imgDir, targetFileName)
    await fs.promises.copyFile(sourceFilePath, targetFilePath)
  }

  private async runOcrBatch(): Promise<void> {
    const ovOcrPath = this.getOvOcrPath()

    try {
      // 在ov-ocr目录下执行run.bat
      await execAsync(`"${PATH_BAT_FILE}"`, {
        cwd: ovOcrPath,
        timeout: 60000 // 60秒超时
      })
    } catch (error) {
      logger.error(`Error running ovocr batch: ${error}`)
      throw new Error(`Failed to run OCR batch: ${error}`)
    }
  }

  private async ocrImage(filePath: string, options?: OcrOvConfig): Promise<OcrResult> {
    logger.info(`OV OCR called on ${filePath} with options ${JSON.stringify(options)}`)
    if (!isWin) {
      logger.warn('System OCR is only supported on Windows')
      return { text: '' }
    }

    try {
      // 2. 清空img目录和output目录
      await this.clearDirectory(this.getImgDir())
      await this.clearDirectory(this.getOutputDir())

      // 3. 把file放到img目录中
      const fileName = path.basename(filePath)
      await this.copyFileToImgDir(filePath, fileName)
      logger.info(`File copied to img directory: ${fileName}`)

      // 4. 运行run.bat
      logger.info('Running OV OCR batch process...')
      await this.runOcrBatch()

      // 5. 检查output/[basename].txt文件必须存在
      const baseNameWithoutExt = path.basename(fileName, path.extname(fileName))
      const outputFilePath = path.join(this.getOutputDir(), `${baseNameWithoutExt}.txt`)
      if (!fs.existsSync(outputFilePath)) {
        throw new Error(`OV OCR output file not found at: ${outputFilePath}`)
      }

      // 6. 读取output/[basename].txt文件内容
      const ocrText = await fs.promises.readFile(outputFilePath, 'utf-8')
      logger.info(`OV OCR text extracted: ${ocrText.substring(0, 100)}...`)

      // 7. 返回结果
      return { text: ocrText }
    } catch (error) {
      logger.error(`Error during OV OCR process: ${error}`)
      throw error
    }
  }

  public ocr = async (file: SupportedOcrFile, options?: OcrOvConfig): Promise<OcrResult> => {
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file.path, options)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const ovOcrService = new OvOcrService()
