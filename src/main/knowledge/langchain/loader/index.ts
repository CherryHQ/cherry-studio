import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { EPubLoader } from '@langchain/community/document_loaders/fs/epub'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { PPTXLoader } from '@langchain/community/document_loaders/fs/pptx'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { SitemapLoader } from '@langchain/community/document_loaders/web/sitemap'
import { LibSQLVectorStore } from '@langchain/community/vectorstores/libsql'
import { loggerService } from '@main/services/LoggerService'
import { UrlSource } from '@main/utils/knowledge'
import { LoaderReturn } from '@shared/config/types'
import { FileMetadata, KnowledgeBaseParams } from '@types'
import { JSONLoader } from 'langchain/document_loaders/fs/json'
import { TextLoader } from 'langchain/document_loaders/fs/text'

import { SplitterFactory } from '../splitter'
import { NoteLoader } from './NoteLoader'
import { YoutubeLoader } from './YoutubeLoader'

const logger = loggerService.withContext('KnowledgeService File Loader')

export async function addFileLoader(
  base: KnowledgeBaseParams,
  vectorStore: LibSQLVectorStore,
  file: FileMetadata
): Promise<LoaderReturn> {
  const fileExt = file.ext.toLowerCase()
  let loaderInstance: TextLoader | PDFLoader | PPTXLoader | DocxLoader | JSONLoader | EPubLoader | undefined
  let specificLoaderType: string = 'unknown'

  switch (fileExt) {
    case '.pdf':
      loaderInstance = new PDFLoader(file.path)
      specificLoaderType = 'pdf'
      break
    case '.txt':
      loaderInstance = new TextLoader(file.path)
      specificLoaderType = 'text'
      break
    case '.pptx':
      loaderInstance = new PPTXLoader(file.path)
      specificLoaderType = 'pptx'
      break
    case '.docx':
      loaderInstance = new DocxLoader(file.path)
      specificLoaderType = 'docx'
      break
    case '.doc':
      loaderInstance = new DocxLoader(file.path, { type: 'doc' })
      specificLoaderType = 'doc'
      break
    case '.json':
      loaderInstance = new JSONLoader(file.path)
      specificLoaderType = 'json'
      break
    case '.epub':
      loaderInstance = new EPubLoader(file.path)
      specificLoaderType = 'epub'
      break
    case '.md':
      loaderInstance = new TextLoader(file.path)
      specificLoaderType = 'markdown'
      break
    default:
      loaderInstance = new TextLoader(file.path)
      specificLoaderType = fileExt.replace('.', '') || 'unknown'
      break
  }

  if (loaderInstance) {
    try {
      const docs = await loaderInstance.load()
      const splitter = SplitterFactory.create({ chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap })
      const splitterResults = await splitter.splitDocuments(docs)
      const ids = await vectorStore.addDocuments(splitterResults)
      return {
        entriesAdded: docs.length,
        uniqueId: ids && ids.length > 0 ? ids[0] : '',
        uniqueIds: ids || [],
        loaderType: specificLoaderType
      }
    } catch (error) {
      logger.error(`Error loading or processing file ${file.path} with loader ${specificLoaderType}: ${error}`)
    }
  }

  return {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType: specificLoaderType
  }
}

export async function addWebLoader(
  base: KnowledgeBaseParams,
  vectorStore: LibSQLVectorStore,
  url: string,
  source: UrlSource
): Promise<LoaderReturn> {
  let loaderInstance: CheerioWebBaseLoader | YoutubeLoader | undefined
  switch (source) {
    case 'normal':
      loaderInstance = new CheerioWebBaseLoader(url)
      break
    case 'youtube':
      loaderInstance = YoutubeLoader.createFromUrl(url, {
        addVideoInfo: true,
        transcriptFormat: 'srt'
      })
      break
    default:
      break
  }
  if (loaderInstance) {
    try {
      const docs = await loaderInstance.load()
      const splitter = SplitterFactory.create({
        chunkSize: base.chunkSize,
        chunkOverlap: base.chunkOverlap,
        type: source === 'youtube' ? 'youtube' : 'recursive'
      })
      const splitterResults = await splitter.splitDocuments(docs)
      const ids = await vectorStore.addDocuments(splitterResults)
      return {
        entriesAdded: docs.length,
        uniqueId: ids && ids.length > 0 ? ids[0] : '',
        uniqueIds: ids || [],
        loaderType: source
      }
    } catch (error) {
      logger.error(`Error loading or processing website ${url} with loader ${source}: ${error}`)
    }
  }

  return {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType: source
  }
}

export async function addSitemapLoader(
  base: KnowledgeBaseParams,
  vectorStore: LibSQLVectorStore,
  url: string
): Promise<LoaderReturn> {
  const loaderInstance = new SitemapLoader(url)
  try {
    const docs = await loaderInstance.load()
    const splitter = SplitterFactory.create({ chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap })
    const splitterResults = await splitter.splitDocuments(docs)
    const ids = await vectorStore.addDocuments(splitterResults)
    return {
      entriesAdded: docs.length,
      uniqueId: ids && ids.length > 0 ? ids[0] : '',
      uniqueIds: ids || [],
      loaderType: 'sitemap'
    }
  } catch (error) {
    logger.error(`Error loading or processing website ${url} with loader sitemap: ${error}`)
  }
  return {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType: 'sitemap'
  }
}

export async function addNoteLoader(
  base: KnowledgeBaseParams,
  vectorStore: LibSQLVectorStore,
  content: string,
  sourceUrl: string
): Promise<LoaderReturn> {
  const loaderInstance = new NoteLoader(content, sourceUrl)
  try {
    const docs = await loaderInstance.load()
    const splitter = SplitterFactory.create({ chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap })
    const splitterResults = await splitter.splitDocuments(docs)
    const ids = await vectorStore.addDocuments(splitterResults)
    return {
      entriesAdded: docs.length,
      uniqueId: ids && ids.length > 0 ? ids[0] : '',
      uniqueIds: ids || [],
      loaderType: 'note'
    }
  } catch (error) {
    logger.error(`Error loading or processing note ${sourceUrl} with loader note: ${error}`)
  }
  return {
    entriesAdded: 0,
    uniqueId: '',
    uniqueIds: [],
    loaderType: 'note'
  }
}
