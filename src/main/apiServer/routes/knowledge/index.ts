import express from 'express'

import { getKnowledgeBase, listKnowledgeBases, searchKnowledge } from './handlers'
import { validateKnowledgeBaseId, validateKnowledgeSearch, validatePagination } from './validators'

const knowledgeRouter = express.Router()

/**
 * @swagger
 * components:
 *   schemas:
 *     KnowledgeBaseEntity:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique knowledge base identifier
 *         name:
 *           type: string
 *           description: Knowledge base name
 *         groupId:
 *           type: string
 *           nullable: true
 *           description: Knowledge base group ID
 *         dimensions:
 *           type: integer
 *           nullable: true
 *           description: Embedding dimensions
 *         embeddingModelId:
 *           type: string
 *           nullable: true
 *           description: Embedding model ID in provider::model format
 *         status:
 *           type: string
 *           enum: [completed, failed]
 *         error:
 *           type: string
 *           nullable: true
 *         rerankModelId:
 *           type: string
 *           nullable: true
 *         fileProcessorId:
 *           type: string
 *           nullable: true
 *         chunkSize:
 *           type: integer
 *           description: Chunk size for document splitting
 *         chunkOverlap:
 *           type: integer
 *           description: Overlap between chunks
 *         threshold:
 *           type: number
 *           description: Similarity threshold
 *         documentCount:
 *           type: integer
 *           description: Number of documents
 *         searchMode:
 *           type: string
 *           enum: [default, bm25, hybrid]
 *         hybridAlpha:
 *           type: number
 *           description: Hybrid vector/BM25 weight
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *
 *     KnowledgeBaseListItem:
 *       allOf:
 *         - $ref: '#/components/schemas/KnowledgeBaseEntity'
 *         - type: object
 *           properties:
 *             itemCount:
 *               type: integer
 *               description: Number of non-deleting knowledge items
 *
 *     KnowledgeSearchResult:
 *       type: object
 *       properties:
 *         pageContent:
 *           type: string
 *           description: Document chunk content
 *         score:
 *           type: number
 *           description: Similarity score
 *         scoreKind:
 *           type: string
 *           enum: [relevance, ranking]
 *         rank:
 *           type: integer
 *           description: Result rank
 *         metadata:
 *           type: object
 *           description: Document metadata
 *         itemId:
 *           type: string
 *           description: Source knowledge item ID
 *         chunkId:
 *           type: string
 *           description: Source vector chunk ID
 *
 *     ListKnowledgeBasesResponse:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/KnowledgeBaseListItem'
 *         total:
 *           type: integer
 *           description: Total number of knowledge bases
 *         page:
 *           type: integer
 *           description: Current v2 page number
 *
 *     SearchKnowledgeRequest:
 *       type: object
 *       properties:
 *         query:
 *           type: string
 *           description: Search query text
 *           minLength: 1
 *           maxLength: 1000
 *         knowledge_base_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Optional list of knowledge base IDs to search. If not provided, searches all knowledge bases.
 *         document_count:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 5
 *           description: Maximum number of results to return
 *       required:
 *         - query
 *
 *     SearchKnowledgeResponse:
 *       type: object
 *       properties:
 *         query:
 *           type: string
 *           description: The original search query
 *         results:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/KnowledgeSearchResult'
 *         total:
 *           type: integer
 *           description: Total number of results
 *         searchedBases:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *           description: Knowledge bases that were searched
 *         warnings:
 *           type: array
 *           items:
 *             type: string
 *           description: Warning messages for partial search failures
 */

/**
 * @swagger
 * /v1/knowledge-bases:
 *   get:
 *     summary: List all knowledge bases
 *     description: Returns a v2-native paginated list of configured knowledge bases.
 *     tags: [Knowledge]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of knowledge bases to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of knowledge bases to skip
 *     responses:
 *       200:
 *         description: List of knowledge bases
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ListKnowledgeBasesResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.get('/', validatePagination, listKnowledgeBases)

/**
 * @swagger
 * /v1/knowledge-bases/{id}:
 *   get:
 *     summary: Get a knowledge base by ID
 *     description: Returns a v2-native knowledge base.
 *     tags: [Knowledge]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Knowledge base ID
 *     responses:
 *       200:
 *         description: Knowledge base details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KnowledgeBaseEntity'
 *       404:
 *         description: Knowledge base not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.get('/:id', validateKnowledgeBaseId, getKnowledgeBase)

/**
 * @swagger
 * /v1/knowledge-bases/search:
 *   post:
 *     summary: Search knowledge bases
 *     description: |
 *       Search across one or more v2 knowledge bases and retrieve relevant document chunks.
 *
 *       Each result includes:
 *       - `pageContent`: The text content of the matching chunk
 *       - `score`: Similarity or ranking score
 *       - `scoreKind`: Whether the score is relevance or ranking based
 *       - `rank`: Result rank within the v2 knowledge runtime
 *       - `metadata`: Source item and chunk metadata
 *
 *       Results are sorted by score in descending order.
 *     tags: [Knowledge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SearchKnowledgeRequest'
 *           example:
 *             query: "How do I configure Ollama embedding?"
 *             knowledge_base_ids: ["kb-uuid-1", "kb-uuid-2"]
 *             document_count: 5
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchKnowledgeResponse'
 *             example:
 *               query: "Ollama embedding config"
 *               results:
 *                 - pageContent: "To use Ollama embeddings, set the base URL to http://localhost:11434"
 *                   score: 0.89
 *                   scoreKind: "relevance"
 *                   rank: 1
 *                   metadata:
 *                     source: "/path/to/doc.md"
 *                     itemType: "file"
 *                     chunkIndex: 0
 *                     tokenCount: 24
 *                   itemId: "01900000-0000-7000-8000-000000000000"
 *                   chunkId: "chunk-1"
 *               total: 1
 *               searchedBases:
 *                 - id: "kb-uuid-1"
 *                   name: "My Docs"
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       502:
 *         description: All knowledge base searches failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
knowledgeRouter.post('/search', validateKnowledgeSearch, searchKnowledge)

export { knowledgeRouter as knowledgeRoutes }
