// src/renderer/src/services/VectorService.ts

// 导入Memory和ShortMemory接口
interface Memory {
  id: string
  content: string
  createdAt: string
  source?: string
  category?: string
  listId: string
  analyzedMessageIds?: string[]
  lastMessageId?: string
  topicId?: string
  vectorRepresentation?: number[]
  entities?: string[]
  keywords?: string[]
  importance?: number
  accessCount?: number
  lastAccessedAt?: string
}

interface ShortMemory {
  id: string
  content: string
  createdAt: string
  topicId: string
  analyzedMessageIds?: string[]
  lastMessageId?: string
  vectorRepresentation?: number[]
  entities?: string[]
  keywords?: string[]
  importance?: number
}
// TODO: Import necessary API clients or libraries for vector embedding (e.g., OpenAI)

/**
 * 计算两个向量之间的余弦相似度
 * @param vecA - 第一个向量
 * @param vecB - 第二个向量
 * @returns 余弦相似度值 (-1 到 1)
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    // console.error('Invalid vectors for cosine similarity calculation.', vecA, vecB)
    return 0 // 或者抛出错误，取决于错误处理策略
  }

  let dotProduct = 0.0
  let normA = 0.0
  let normB = 0.0
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) {
    // console.warn('Zero vector encountered in cosine similarity calculation.')
    return 0 // 避免除以零
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 简单的内存缓存来存储向量表示
const vectorCache = new Map<string, number[]>()

/**
 * VectorService 类负责处理记忆内容的向量化和相似度计算
 */
class VectorService {
  /**
   * 获取给定文本的向量表示。
   * 优先从缓存获取，否则调用API生成。
   * @param text - 需要向量化的文本
   * @param modelId - 使用的向量化模型ID (TODO: 需要从设置或状态中获取)
   * @returns 文本的向量表示 (number[]) 或 null (如果失败)
   */
  async getVector(text: string, modelId: string = 'text-embedding-ada-002'): Promise<number[] | null> {
    if (!text || text.trim() === '') {
      return null
    }

    const cacheKey = `${modelId}:${text}`
    if (vectorCache.has(cacheKey)) {
      return vectorCache.get(cacheKey)!
    }

    try {
      // TODO: 实现调用向量化API的逻辑
      console.log(`[VectorService] Requesting vector for text (length: ${text.length})...`)
      // 示例: const response = await openai.embeddings.create({ model: modelId, input: text });
      // const vector = response?.data?.[0]?.embedding;

      // --- 占位符逻辑 ---
      // 实际应调用 API 获取向量
      // 这里生成一个随机向量作为占位符，维度需与模型一致
      const placeholderVector = Array.from({ length: 1536 }, () => Math.random() * 2 - 1) // 假设 ada-002 是 1536 维
      const vector = placeholderVector
      // --- 占位符结束 ---

      if (vector) {
        vectorCache.set(cacheKey, vector)
        console.log(`[VectorService] Vector obtained and cached for text (length: ${text.length}).`)
        return vector
      } else {
        console.error('[VectorService] Failed to get vector embedding.')
        return null
      }
    } catch (error) {
      console.error('[VectorService] Error getting vector embedding:', error)
      return null
    }
  }

  /**
   * 确保一个记忆项具有向量表示。
   * 如果没有，则尝试生成并更新。
   * @param memory - 记忆项 (Memory 或 ShortMemory)
   * @returns 更新后的记忆项 (如果成功生成向量) 或原记忆项
   */
  async ensureVectorRepresentation(memory: Memory | ShortMemory): Promise<Memory | ShortMemory> {
    if (memory.vectorRepresentation && memory.vectorRepresentation.length > 0) {
      return memory // 已经有向量了
    }

    // 从状态或设置中获取 vectorizeModel
    const vectorizeModel = 'text-embedding-ada-002' // 暂时硬编码
    const vector = await this.getVector(memory.content, vectorizeModel)

    if (vector) {
      return { ...memory, vectorRepresentation: vector }
    }

    return memory // 无法生成向量，返回原样
  }

  /**
   * 计算两个记忆项之间的语义相似度。
   * @param memoryA - 第一个记忆项
   * @param memoryB - 第二个记忆项
   * @returns 相似度分数 (0 到 1) 或 0 (如果无法计算)
   */
  async calculateSimilarity(memoryA: Memory | ShortMemory, memoryB: Memory | ShortMemory): Promise<number> {
    try {
      const memoryAWithVector = await this.ensureVectorRepresentation(memoryA)
      const memoryBWithVector = await this.ensureVectorRepresentation(memoryB)

      if (
        memoryAWithVector.vectorRepresentation &&
        memoryBWithVector.vectorRepresentation &&
        memoryAWithVector.vectorRepresentation.length > 0 &&
        memoryBWithVector.vectorRepresentation.length > 0
      ) {
        const similarity = cosineSimilarity(
          memoryAWithVector.vectorRepresentation,
          memoryBWithVector.vectorRepresentation
        )
        // 将余弦相似度 (-1 到 1) 映射到 0 到 1 范围 (可选，但通常更直观)
        return (similarity + 1) / 2
      } else {
        // console.warn('[VectorService] Could not calculate similarity due to missing vectors.')
        return 0
      }
    } catch (error) {
      console.error('[VectorService] Error calculating similarity:', error)
      return 0
    }
  }

  /**
   * 查找与给定记忆最相似的记忆项列表。
   * @param targetMemory - 目标记忆项
   * @param candidates - 候选记忆项列表
   * @param topN - 返回最相似的 N 个结果
   * @param threshold - 相似度阈值 (0 到 1)
   * @returns 最相似的记忆项列表及其相似度分数
   */
  async findSimilarMemories(
    targetMemory: Memory | ShortMemory,
    candidates: (Memory | ShortMemory)[],
    topN: number = 5,
    threshold: number = 0.7 // 默认阈值
  ): Promise<{ memory: Memory | ShortMemory; similarity: number }[]> {
    const targetMemoryWithVector = await this.ensureVectorRepresentation(targetMemory)

    if (!targetMemoryWithVector.vectorRepresentation || targetMemoryWithVector.vectorRepresentation.length === 0) {
      console.warn('[VectorService] Target memory has no vector representation. Cannot find similar memories.')
      return []
    }

    const results: { memory: Memory | ShortMemory; similarity: number }[] = []

    for (const candidate of candidates) {
      // 排除目标记忆自身
      if (candidate.id === targetMemory.id) {
        continue
      }

      const similarity = await this.calculateSimilarity(targetMemoryWithVector, candidate)
      if (similarity >= threshold) {
        results.push({ memory: candidate, similarity })
      }
    }

    // 按相似度降序排序
    results.sort((a, b) => b.similarity - a.similarity)

    // 返回前 N 个结果
    return results.slice(0, topN)
  }

  /**
   * 计算查询文本与一组记忆项的相似度。
   * @param queryText - 查询文本
   * @param candidates - 候选记忆项列表
   * @param topN - 返回最相似的 N 个结果
   * @param threshold - 相似度阈值 (0 到 1)
   * @returns 最相似的记忆项列表及其相似度分数
   */
  async findSimilarMemoriesToQuery(
    queryText: string,
    candidates: (Memory | ShortMemory)[],
    topN: number = 10,
    threshold: number = 0.7
  ): Promise<{ memory: Memory | ShortMemory; similarity: number }[]> {
    const queryVector = await this.getVector(queryText)
    if (!queryVector) {
      console.warn('[VectorService] Could not get vector for query text. Cannot find similar memories.')
      return []
    }

    const results: { memory: Memory | ShortMemory; similarity: number }[] = []

    for (const candidate of candidates) {
      const candidateWithVector = await this.ensureVectorRepresentation(candidate)
      if (candidateWithVector.vectorRepresentation && candidateWithVector.vectorRepresentation.length > 0) {
        const similarity = cosineSimilarity(queryVector, candidateWithVector.vectorRepresentation)
        const normalizedSimilarity = (similarity + 1) / 2 // 归一化到 0-1
        if (normalizedSimilarity >= threshold) {
          results.push({ memory: candidate, similarity: normalizedSimilarity })
        }
      }
    }

    results.sort((a, b) => b.similarity - a.similarity)
    return results.slice(0, topN)
  }

  /**
   * 清空向量缓存
   */
  clearCache(): void {
    vectorCache.clear()
    console.log('[VectorService] Vector cache cleared.')
  }
}

// 导出 VectorService 的单例
export const vectorService = new VectorService()
