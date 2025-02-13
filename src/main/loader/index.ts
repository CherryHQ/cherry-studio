import * as fs from 'node:fs'

import { LocalPathLoader, RAGApplication, TextLoader } from '@llm-tools/embedjs'
import type { AddLoaderReturn } from '@llm-tools/embedjs-interfaces'
import { LoaderReturn } from '@shared/config/types'
import { FileType, KnowledgeBaseParams } from '@types'
import Logger from 'electron-log'

import { OdLoader, OdType } from './odLoader'

// embedjs内置loader类型
const commonExts = ['.pdf', '.csv', '.json', '.docx', '.pptx', '.xlsx', '.md']

export async function addOdLoader(
  ragApplication: RAGApplication,
  file: FileType,
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
  file: FileType,
  base: KnowledgeBaseParams,
  forceReload: boolean
): Promise<LoaderReturn> {
  // 内置类型
  if (commonExts.includes(file.ext)) {
    const loaderReturn = await ragApplication.addLoader(
      // @ts-ignore LocalPathLoader
      new LocalPathLoader({ path: file.path, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as any,
      forceReload
    )
    return {
      entriesAdded: loaderReturn.entriesAdded,
      uniqueId: loaderReturn.uniqueId,
      uniqueIds: [loaderReturn.uniqueId],
      loaderType: loaderReturn.loaderType
    } as LoaderReturn
  }

  // 自定义类型
  if (['.odt', '.ods', '.odp'].includes(file.ext)) {
    const loaderReturn = await addOdLoader(ragApplication, file, base, forceReload)
    return {
      entriesAdded: loaderReturn.entriesAdded,
      uniqueId: loaderReturn.uniqueId,
      uniqueIds: [loaderReturn.uniqueId],
      loaderType: loaderReturn.loaderType
    } as LoaderReturn
  }

  // 文本类型
  const fileContent = fs.readFileSync(file.path, 'utf-8')
  const loaderReturn = await ragApplication.addLoader(
    new TextLoader({ text: fileContent, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as any,
    forceReload
  )

  Logger.info('[KnowledgeBase] processing file', file.path)

  return {
    entriesAdded: loaderReturn.entriesAdded,
    uniqueId: loaderReturn.uniqueId,
    uniqueIds: [loaderReturn.uniqueId],
    loaderType: loaderReturn.loaderType
  } as LoaderReturn
}
