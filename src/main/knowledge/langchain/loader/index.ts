import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { EPubLoader } from '@langchain/community/document_loaders/fs/epub'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { PPTXLoader } from '@langchain/community/document_loaders/fs/pptx'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { SitemapLoader } from '@langchain/community/document_loaders/web/sitemap'
import { FaissStore } from '@langchain/community/vectorstores/faiss'
import { Document } from '@langchain/core/documents'
import { loggerService } from '@logger'
import { UrlSource } from '@main/utils/knowledge'
import { LoaderReturn } from '@shared/config/types'
import { FileMetadata, FileTypes, KnowledgeBaseParams } from '@types'
import { randomUUID } from 'crypto'
import { JSONLoader } from 'langchain/document_loaders/fs/json'
import { TextLoader } from 'langchain/document_loaders/fs/text'

import { SplitterFactory } from '../splitter'
import { MarkdownLoader } from './MarkdownLoader'
import { NoteLoader } from './NoteLoader'
import { YoutubeLoader } from './YoutubeLoader'

const logger = loggerService.withContext('KnowledgeService File Loader')

type LoaderInstance =
  | TextLoader
  | PDFLoader
  | PPTXLoader
  | DocxLoader
  | JSONLoader
  | EPubLoader
  | CheerioWebBaseLoader
  | YoutubeLoader
  | SitemapLoader
  | NoteLoader
  | MarkdownLoader

/**
 * 为文档数组中的每个文档的 metadata 添加类型信息。
 */
function formatDocument(docs: Document[], type: string): Document[] {
  return docs.map((doc) => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      type: type
    }
  }))
}

/**
 * 通用文档处理管道
 */
async function processDocuments(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  docs: Document[],
  loaderType: string,
  splitterType?: string
): Promise<LoaderReturn> {
  const formattedDocs = formatDocument(docs, loaderType)
  const splitter = SplitterFactory.create({
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    ...(splitterType && { type: splitterType })
  })

  const splitterResults = await splitter.splitDocuments(formattedDocs)
  const ids = splitterResults.map(() => randomUUID())

  await vectorStore.addDocuments(splitterResults, { ids })

  return {
    entriesAdded: splitterResults.length,
    uniqueId: ids[0] || '',
    uniqueIds: ids,
    loaderType
  }
}

/**
 * 通用加载器执行函数
 */
async function executeLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  loaderInstance: LoaderInstance,
  loaderType: string,
  identifier: string,
  splitterType?: string
): Promise<LoaderReturn> {
  const emptyResult: LoaderReturn = {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType
  }

  try {
    const docs = await loaderInstance.load()
    return await processDocuments(base, vectorStore, docs, loaderType, splitterType)
  } catch (error) {
    logger.error(`Error loading or processing ${identifier} with loader ${loaderType}: ${error}`)
    return emptyResult
  }
}

/**
 * 文件扩展名到加载器的映射
 */
const FILE_LOADER_MAP: Record<string, { loader: new (path: string) => LoaderInstance; type: string }> = {
  '.pdf': { loader: PDFLoader, type: 'pdf' },
  '.txt': { loader: TextLoader, type: 'text' },
  '.pptx': { loader: PPTXLoader, type: 'pptx' },
  '.docx': { loader: DocxLoader, type: 'docx' },
  '.doc': { loader: DocxLoader, type: 'doc' },
  '.json': { loader: JSONLoader, type: 'json' },
  '.epub': { loader: EPubLoader, type: 'epub' },
  '.md': { loader: MarkdownLoader, type: 'markdown' }
}

export async function addFileLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  file: FileMetadata
): Promise<LoaderReturn> {
  const fileExt = file.ext.toLowerCase()
  const loaderConfig = FILE_LOADER_MAP[fileExt]

  if (!loaderConfig) {
    // 默认使用文本加载器
    const loaderInstance = new TextLoader(file.path)
    const type = fileExt.replace('.', '') || 'unknown'
    return executeLoader(base, vectorStore, loaderInstance, type, file.path)
  }

  const loaderInstance = new loaderConfig.loader(file.path)
  return executeLoader(base, vectorStore, loaderInstance, loaderConfig.type, file.path)
}

export async function addWebLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  url: string,
  source: UrlSource
): Promise<LoaderReturn> {
  let loaderInstance: CheerioWebBaseLoader | YoutubeLoader | undefined
  let splitterType: string | undefined

  switch (source) {
    case 'normal':
      loaderInstance = new CheerioWebBaseLoader(url)
      break
    case 'youtube':
      loaderInstance = YoutubeLoader.createFromUrl(url, {
        addVideoInfo: true,
        transcriptFormat: 'srt'
      })
      splitterType = 'srt'
      break
  }

  if (!loaderInstance) {
    return {
      entriesAdded: 0,
      uniqueId: '',
      uniqueIds: [],
      loaderType: source
    }
  }

  return executeLoader(base, vectorStore, loaderInstance, source, url, splitterType)
}

export async function addSitemapLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  url: string
): Promise<LoaderReturn> {
  const loaderInstance = new SitemapLoader(url)
  return executeLoader(base, vectorStore, loaderInstance, 'sitemap', url)
}

export async function addNoteLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  content: string,
  sourceUrl: string
): Promise<LoaderReturn> {
  const loaderInstance = new NoteLoader(content, sourceUrl)
  return executeLoader(base, vectorStore, loaderInstance, 'note', sourceUrl)
}

export async function addVideoLoader(
  base: KnowledgeBaseParams,
  vectorStore: FaissStore,
  files: FileMetadata[]
): Promise<LoaderReturn> {
  const srtFile = files.find((f) => f.type === FileTypes.TEXT)
  const videoFile = files.find((f) => f.type === FileTypes.VIDEO)

  const emptyResult: LoaderReturn = {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType: 'video'
  }

  if (!srtFile || !videoFile) {
    return emptyResult
  }

  try {
    const loaderInstance = new TextLoader(srtFile.path)
    const originalDocs = await loaderInstance.load()

    const docsWithVideoMeta = originalDocs.map(
      (doc) =>
        new Document({
          ...doc,
          metadata: {
            ...doc.metadata,
            video: {
              path: videoFile.path,
              name: videoFile.origin_name
            }
          }
        })
    )

    return await processDocuments(base, vectorStore, docsWithVideoMeta, 'video', 'srt')
  } catch (error) {
    logger.error(`Error loading or processing file ${srtFile.path} with loader video: ${error}`)
    return emptyResult
  }
}
