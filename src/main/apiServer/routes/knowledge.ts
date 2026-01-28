import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import express, { type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('ApiServer:Knowledge')

// 内存中存储请求状态（生产环境建议使用持久化存储）
const ingestRequests = new Map<
  string,
  {
    status: 'queued' | 'processing' | 'completed' | 'failed'
    baseId: string
    type: string
    createdAt: number
    error?: string
  }
>()

// 本地类型定义，避免从 @renderer/types 导入
export interface IngestRequestPayload {
  baseId: string
  type: 'url' | 'selection' | 'content'
  page: { url: string; title?: string }
  payload: {
    selectedText?: string
    contentText?: string
    contentHtml?: string
  }
  remark?: string
}

export interface KnowledgeBaseMinimal {
  id: string
  name: string
  description?: string
  itemCount: number
}

// 知识库项类型（本地定义）
type KnowledgeItemType = 'file' | 'directory' | 'url' | 'sitemap' | 'note' | 'video'

interface KnowledgeItemBase {
  id: string
  type: KnowledgeItemType
  content: string | FileMetadata | FileMetadata[]
  remark?: string
  created_at: number
  updated_at: number
  sourceUrl?: string
}

// 简化的 FileMetadata
interface FileMetadata {
  name: string
  path: string
  size: number
  ext: string
  [key: string]: any
}

type KnowledgeItem = Partial<KnowledgeItemBase>

const router = express.Router()

/**
 * @swagger
 * /v1/knowledge/bases:
 *   get:
 *     summary: Get knowledge bases list
 *     description: Returns minimal information about all knowledge bases
 *     tags: [Knowledge]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of knowledge bases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bases:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/KnowledgeBaseMinimal'
 */
router.get('/bases', async (_req: Request, res: Response) => {
  try {
    const mainWindow = _req.app.get('mainWindow') as Electron.BrowserWindow | undefined

    if (!mainWindow) {
      return res.status(503).json({
        error: 'Main window not ready',
        message: 'Please ensure the application is fully loaded'
      })
    }

    // 发送 IPC 消息到渲染进程获取知识库列表
    const bases = (await mainWindow.webContents.executeJavaScript(`
      window.__getKnowledgeBasesForAPI?.() || []
    `)) as Array<{
      id: string
      name: string
      description?: string
      items: unknown[]
    }>

    // 返回最小字段集
    const minimalBases: KnowledgeBaseMinimal[] = bases.map((base) => ({
      id: base.id,
      name: base.name,
      description: base.description,
      itemCount: base.items.length
    }))

    return res.json({ bases: minimalBases })
  } catch (error) {
    logger.error('Failed to get knowledge bases:', error as Error)
    return res.status(500).json({
      error: 'Failed to get knowledge bases',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * @swagger
 * /v1/knowledge/ingest:
 *   post:
 *     summary: Submit content to knowledge base
 *     description: Submit a URL, selected text, or page content to be added to a knowledge base
 *     tags: [Knowledge]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - baseId
 *               - type
 *               - page
 *             properties:
 *               baseId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [url, selection, content]
 *               page:
 *                 type: object
 *                 properties:
 *                   url:
 *                     type: string
 *                   title:
 *                     type: string
 *               payload:
 *                 type: object
 *                 properties:
 *                   selectedText:
 *                     type: string
 *                   contentText:
 *                     type: string
 *                   contentHtml:
 *                     type: string
 *               remark:
 *                 type: string
 *     responses:
 *       202:
 *         description: Request accepted for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accepted:
 *                   type: boolean
 *                 requestId:
 *                   type: string
 *                 queuedAt:
 *                   type: integer
 */
router.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { baseId, type, page, payload, remark }: IngestRequestPayload = req.body

    // 验证必填字段
    if (!baseId || !type || !page || !page.url) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'baseId, type, and page.url are required'
      })
    }

    // 验证 type
    if (!['url', 'selection', 'content'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type',
        message: 'Type must be one of: url, selection, content'
      })
    }

    // 内容长度限制
    const MAX_CONTENT_LENGTH = 5 * 1024 * 1024 // 5MB
    if (payload.contentText && payload.contentText.length > MAX_CONTENT_LENGTH) {
      return res.status(413).json({
        error: 'Content too large',
        message: `Content text exceeds ${MAX_CONTENT_LENGTH} bytes`
      })
    }

    const mainWindow = req.app.get('mainWindow') as Electron.BrowserWindow | undefined

    if (!mainWindow) {
      return res.status(503).json({
        error: 'Main window not ready',
        message: 'Please ensure the application is fully loaded'
      })
    }

    // 生成请求 ID
    const requestId = uuidv4()

    // 记录请求状态
    ingestRequests.set(requestId, {
      status: 'queued',
      baseId,
      type,
      createdAt: Date.now()
    })

    // 构建知识库项
    let item: KnowledgeItem

    switch (type) {
      case 'url':
        item = {
          id: uuidv4(),
          type: 'url',
          content: page.url,
          remark: remark || page.title || page.url
        }
        break

      case 'selection':
        item = {
          id: uuidv4(),
          type: 'note',
          content: payload.selectedText || '',
          remark: remark || `Selection from ${page.title || page.url}`,
          sourceUrl: page.url
        }
        break

      case 'content':
        item = {
          id: uuidv4(),
          type: 'note',
          content: payload.contentText || '',
          remark: remark || page.title || page.url,
          sourceUrl: page.url
        }
        break

      default:
        return res.status(400).json({
          error: 'Invalid type',
          message: 'Type must be one of: url, selection, content'
        })
    }

    // 添加时间戳
    item.created_at = Date.now()
    item.updated_at = Date.now()

    // 通过 IPC 发送到渲染进程
    mainWindow.webContents.send(IpcChannel.KnowledgeBase_IngestRequest, {
      requestId,
      baseId,
      item
    })

    // 返回 202 Accepted
    return res.status(202).json({
      accepted: true,
      requestId,
      queuedAt: Date.now()
    })
  } catch (error) {
    logger.error('Failed to process ingest request:', error as Error)
    return res.status(500).json({
      error: 'Failed to process ingest request',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * @swagger
 * /v1/knowledge/ingest/{requestId}:
 *   get:
 *     summary: Get ingest request status
 *     description: Query the status of a previously submitted ingest request
 *     tags: [Knowledge]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [queued, processing, completed, failed]
 *                 error:
 *                   type: string
 *       404:
 *         description: Request not found
 */
router.get('/ingest/:requestId', (req: Request, res: Response) => {
  try {
    const { requestId } = req.params
    const request = ingestRequests.get(requestId)

    if (!request) {
      return res.status(404).json({
        error: 'Request not found',
        message: `No ingest request found with ID: ${requestId}`
      })
    }

    return res.json({
      requestId,
      status: request.status,
      error: request.error
    })
  } catch (error) {
    logger.error('Failed to get ingest status:', error as Error)
    return res.status(500).json({
      error: 'Failed to get ingest status',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export { router as knowledgeRoutes }
