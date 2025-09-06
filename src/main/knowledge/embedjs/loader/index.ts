import { JsonLoader, LocalPathLoader, RAGApplication, TextLoader } from '@cherrystudio/embedjs'
import type { AddLoaderReturn } from '@cherrystudio/embedjs-interfaces'
import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { loggerService } from '@logger'
import { readTextFileWithAutoEncoding } from '@main/utils/file'
import { LoaderReturn } from '@shared/config/types'
import { FileMetadata, KnowledgeBaseParams } from '@types'

import { DraftsExportLoader } from './draftsExportLoader'
import { EpubLoader } from './epubLoader'
import { OdLoader, OdType } from './odLoader'

const logger = loggerService.withContext('KnowledgeLoader')

// 文件扩展名到加载器类型的映射
const FILE_LOADER_MAP: Record<string, string> = {
  // 内置类型
  '.pdf': 'common',
  '.csv': 'common',
  '.doc': 'common',
  '.docx': 'common',
  '.pptx': 'common',
  '.xlsx': 'common',
  '.md': 'common',
  // OD类型
  '.odt': 'od',
  '.ods': 'od',
  '.odp': 'od',
  // epub类型
  '.epub': 'epub',
  // Drafts类型
  '.draftsexport': 'drafts',
  // HTML类型
  '.html': 'html',
  '.htm': 'html',
  // JSON类型
  '.json': 'json'
  // 其他类型默认为文本类型
}

export async function addOdLoader(
  ragApplication: RAGApplication,
  file: FileMetadata,
  base: KnowledgeBaseParams,
  forceReload: boolean
): Promise<AddLoaderReturn> {
  const loaderMap: Record<string, OdType> = {
    '.odt': OdType.OdtLoader,
    '.ods': OdType.OdsLoader,
    '.odp': OdType.OdpLoader
  }
  const odType = loaderMap[file.ext]
  if (!odType) {
    throw new Error('Unknown odType')
  }
  return ragApplication.addLoader(
    new OdLoader({
      odType,
      filePath: file.path,
      chunkSize: base.chunkSize,
      chunkOverlap: base.chunkOverlap
    }) as any,
    forceReload
  )
}

export async function addFileLoader(
  ragApplication: RAGApplication,
  file: FileMetadata,
  base: KnowledgeBaseParams,
  forceReload: boolean
): Promise<LoaderReturn> {
  // 获取文件类型，如果没有匹配则默认为文本类型
  const loaderType = FILE_LOADER_MAP[file.ext.toLowerCase()] || 'text'
  let loaderReturn: AddLoaderReturn
  // 使用文件的实际路径
  const filePath = file.path

  // JSON类型处理
  let jsonObject = {}
  let jsonParsed = true
  logger.info(`[KnowledgeBase] processing file ${filePath} as ${loaderType} type`)
  switch (loaderType) {
    case 'common':
      // 内置类型处理
      loaderReturn = await ragApplication.addLoader(
        new LocalPathLoader({
          path: filePath,
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap
        }) as any,
        forceReload
      )
      break

    case 'od':
      // OD类型处理
      loaderReturn = await addOdLoader(ragApplication, file, base, forceReload)
      break
    case 'epub':
      // epub类型处理
      loaderReturn = await ragApplication.addLoader(
        new EpubLoader({
          filePath: filePath,
          chunkSize: base.chunkSize ?? 1000,
          chunkOverlap: base.chunkOverlap ?? 200
        }) as any,
        forceReload
      )
      break

    case 'drafts':
      // Drafts类型处理
      loaderReturn = await ragApplication.addLoader(new DraftsExportLoader(filePath), forceReload)
      break

    case 'html':
      // HTML类型处理
      loaderReturn = await ragApplication.addLoader(
        new WebLoader({
          urlOrContent: await readTextFileWithAutoEncoding(filePath),
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap
        }) as any,
        forceReload
      )
      break

    case 'json':
      try {
        jsonObject = JSON.parse(await readTextFileWithAutoEncoding(filePath))
      } catch (error) {
        jsonParsed = false
        logger.warn(
          `[KnowledgeBase] failed parsing json file, falling back to text processing: ${filePath}`,
          error as Error
        )
      }

      if (jsonParsed) {
        loaderReturn = await ragApplication.addLoader(new JsonLoader({ object: jsonObject }), forceReload)
        break
      }
    // fallthrough - JSON 解析失败时作为文本处理
    default:
      // 文本类型处理（默认）
      // 如果是其他文本类型且尚未读取文件，则读取文件
      loaderReturn = await ragApplication.addLoader(
        new TextLoader({
          text: await readTextFileWithAutoEncoding(filePath),
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap
        }) as any,
        forceReload
      )
      break
  }

  return {
    entriesAdded: loaderReturn.entriesAdded,
    uniqueId: loaderReturn.uniqueId,
    uniqueIds: [loaderReturn.uniqueId],
    loaderType: loaderReturn.loaderType
  } as LoaderReturn
}
