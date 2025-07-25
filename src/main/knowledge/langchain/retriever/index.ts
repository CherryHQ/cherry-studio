import { BM25Retriever } from '@langchain/community/retrievers/bm25'
import { BaseRetriever } from '@langchain/core/retrievers'
import { VectorStore } from '@langchain/core/vectorstores'
import { loggerService } from '@main/services/LoggerService'
import { type KnowledgeBaseParams } from '@types'
import { type Document } from 'langchain/document'
import { EnsembleRetriever } from 'langchain/retrievers/ensemble'

const logger = loggerService.withContext('RetrieverFactory')
export class RetrieverFactory {
  /**
   * 根据提供的参数创建一个 LangChain 检索器 (Retriever)。
   * @param base 知识库配置参数。
   * @param vectorStore 一个已初始化的向量存储实例。
   * @param documents 文档列表，用于初始化 BM25Retriever。
   * @returns 返回一个 BaseRetriever 实例。
   */
  public createRetriever(base: KnowledgeBaseParams, vectorStore: VectorStore, documents: Document[]): BaseRetriever {
    const retrieverType = base.retriever ?? 'vector'
    const searchK = base.documentCount ?? 5

    logger.info(`Creating retriever of type: ${retrieverType} with k=${searchK}`)

    switch (retrieverType) {
      case 'bm25':
        if (documents.length === 0) {
          throw new Error('BM25Retriever requires documents, but none were provided or found.')
        }
        logger.info('Create BM25 Retriever')
        return BM25Retriever.fromDocuments(documents, { k: searchK })

      case 'hybrid': {
        if (documents.length === 0) {
          logger.warn('No documents provided for BM25 part of hybrid search. Falling back to vector search only.')
          return vectorStore.asRetriever(searchK)
        }

        const vectorstoreRetriever = vectorStore.asRetriever(searchK)
        const bm25Retriever = BM25Retriever.fromDocuments(documents, { k: searchK })

        logger.info('Create Hybrid Retriever')
        return new EnsembleRetriever({
          retrievers: [vectorstoreRetriever, bm25Retriever],
          weights: [0.7, 0.3]
        })
      }

      case 'vector':
      default:
        logger.info('Create Vector Retriever')
        return vectorStore.asRetriever(searchK)
    }
  }
}
