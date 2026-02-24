/**
 * Cherry Studio → Sync Server 增量推送
 *
 * 零侵入设计：只需在 entryPoint.tsx 中 import 此文件即可启用同步。
 * 逻辑：每 SYNC_INTERVAL 毫秒轮询一次，对比 Topic 快照（ID + updatedAt），
 *        将新增/更新/删除的 Topic 推送到同步服务器。
 *
 * 配置方式（优先级从高到低）：
 *   1. localStorage（运行时覆盖，DevTools Console 中设置）：
 *      localStorage.setItem('cherry-sync-server', 'http://your-server:3456')
 *      localStorage.setItem('cherry-sync-token', 'your-token')
 *   2. .env 文件（项目根目录，参考 .env.sync 模板）：
 *      RENDERER_VITE_SYNC_SERVER=http://your-server:3456
 *      RENDERER_VITE_SYNC_TOKEN=your-token
 */
import db from '@renderer/databases'

// ── 配置 ──────────────────────────────────────────────────────────────

const SYNC_INTERVAL = 30_000 // 30 秒
const BATCH_SIZE = 20 // 批量上传时每批最大数量
const INIT_DELAY = 8_000 // 初始化延迟（等 Dexie + Redux persist 准备好）

function getConfig() {
  const server =
    localStorage.getItem('cherry-sync-server') || import.meta.env.RENDERER_VITE_SYNC_SERVER || ''
  const token =
    localStorage.getItem('cherry-sync-token') || import.meta.env.RENDERER_VITE_SYNC_TOKEN || ''
  return { server: server.replace(/\/+$/, ''), token }
}

// ── 类型 ──────────────────────────────────────────────────────────────

interface TopicSnapshot {
  id: string
  updatedAt: string
}

interface TopicFullData {
  topicId: string
  name: string
  assistantId: string | null
  assistantName: string
  createdAt: string | null
  updatedAt: string | null
  messages: Array<{
    id: string
    role: string
    createdAt: string
    status: string
    model?: unknown
    usage?: unknown
    metrics?: unknown
    mentions?: unknown
    blocks: unknown[]
  }>
}

// ── 状态 ──────────────────────────────────────────────────────────────

const SNAPSHOT_KEY = 'cherry-sync-snapshot' // localStorage key for persisted snapshot

/** 从 localStorage 恢复上次的快照（App 重启后不丢失） */
function loadPersistedSnapshot(): Map<string, string> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return new Map()
    const entries: [string, string][] = JSON.parse(raw)
    return new Map(entries)
  } catch {
    return new Map()
  }
}

/** 将快照持久化到 localStorage */
function savePersistedSnapshot(snapshot: Map<string, string>) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify([...snapshot.entries()]))
  } catch {
    // localStorage 满了之类的极端情况，忽略
  }
}

let previousSnapshot: Map<string, string> | null = null // null = 尚未初始化

// ── 工具函数 ──────────────────────────────────────────────────────────

/** 从 localStorage 的 redux-persist 数据中提取 Topic 元数据快照 */
function getTopicSnapshotFromStore(): Map<string, string> {
  try {
    const persistRaw = localStorage.getItem('persist:cherry-studio')
    if (!persistRaw) return new Map()

    const persist = JSON.parse(persistRaw)
    const assistantsData = JSON.parse(persist.assistants || '{}')
    const assistants = assistantsData.assistants || []

    const snapshot = new Map<string, string>()
    for (const assistant of assistants) {
      for (const topic of assistant.topics || []) {
        if (topic.id) {
          snapshot.set(topic.id, topic.updatedAt || topic.createdAt || '')
        }
      }
    }
    return snapshot
  } catch (e) {
    console.error('[TopicSync] Failed to read store snapshot:', e)
    return new Map()
  }
}

/** 获取 Topic 元数据（名字、assistantId 等），来自 redux-persist */
function getTopicMeta(topicId: string): {
  name: string
  assistantId: string | null
  assistantName: string
  createdAt: string | null
  updatedAt: string | null
} | null {
  try {
    const persistRaw = localStorage.getItem('persist:cherry-studio')
    if (!persistRaw) return null

    const persist = JSON.parse(persistRaw)
    const assistantsData = JSON.parse(persist.assistants || '{}')

    for (const assistant of assistantsData.assistants || []) {
      const found = (assistant.topics || []).find((t: { id: string }) => t.id === topicId)
      if (found) {
        return {
          name: found.name || '未命名',
          assistantId: assistant.id || null,
          assistantName: assistant.name || '',
          createdAt: found.createdAt || null,
          updatedAt: found.updatedAt || null
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/** 从 IndexedDB 读取 Topic 完整消息数据并组装 */
async function getTopicFullData(topicId: string): Promise<TopicFullData | null> {
  try {
    const topic = await db.topics.get(topicId)
    if (!topic) return null

    const messages = topic.messages || []
    if (messages.length === 0) {
      const meta = getTopicMeta(topicId)
      return {
        topicId,
        name: meta?.name || '未命名',
        assistantId: meta?.assistantId || null,
        assistantName: meta?.assistantName || '',
        createdAt: meta?.createdAt || null,
        updatedAt: meta?.updatedAt || null,
        messages: []
      }
    }

    // 批量获取所有相关的 message blocks
    const allBlockIds = messages.flatMap((m) => (m.blocks || []).map(String))
    const blocks =
      allBlockIds.length > 0 ? await db.message_blocks.where('id').anyOf(allBlockIds).toArray() : []

    const blockMap = new Map(blocks.map((b) => [b.id, b]))
    const meta = getTopicMeta(topicId)

    return {
      topicId,
      name: meta?.name || '未命名',
      assistantId: meta?.assistantId || null,
      assistantName: meta?.assistantName || '',
      createdAt: meta?.createdAt || null,
      updatedAt: meta?.updatedAt || null,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        createdAt: msg.createdAt,
        status: msg.status,
        model: msg.model,
        usage: msg.usage,
        metrics: msg.metrics,
        mentions: msg.mentions,
        blocks: (msg.blocks || []).map((bid) => blockMap.get(String(bid))).filter(Boolean)
      }))
    }
  } catch (e) {
    console.error(`[TopicSync] Failed to get topic data for ${topicId}:`, e)
    return null
  }
}

// ── HTTP 工具 ─────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown): Promise<boolean> {
  const { server, token } = getConfig()
  if (!server) return false
  try {
    const resp = await fetch(`${server}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) {
      console.error(`[TopicSync] POST ${path} failed:`, resp.status, await resp.text())
      return false
    }
    return true
  } catch (e) {
    console.error(`[TopicSync] POST ${path} network error:`, e)
    return false
  }
}

async function apiDelete(path: string): Promise<boolean> {
  const { server, token } = getConfig()
  if (!server) return false
  try {
    const resp = await fetch(`${server}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!resp.ok) {
      console.error(`[TopicSync] DELETE ${path} failed:`, resp.status)
      return false
    }
    return true
  } catch (e) {
    console.error(`[TopicSync] DELETE ${path} network error:`, e)
    return false
  }
}

// ── 同步主循环 ────────────────────────────────────────────────────────

async function syncOnce(): Promise<void> {
  const { server } = getConfig()
  if (!server) return // 未配置同步服务器，静默跳过

  try {
    const currentSnapshot = getTopicSnapshotFromStore()

    // 首次运行：从 localStorage 恢复快照（可能为空）
    if (previousSnapshot === null) {
      previousSnapshot = loadPersistedSnapshot()
      console.log(
        `[TopicSync] Initialized: ${currentSnapshot.size} local topics, ` +
          `${previousSnapshot.size} in last synced snapshot`
      )
      // 不 return —— 继续往下 diff，这样：
      // - 全新安装（空快照）→ 所有 Topic 视为"新增" → 全量推送
      // - 重启（有快照）→ 只推送变更的 Topic
    }

    // 计算 diff
    const added: string[] = []
    const updated: string[] = []
    const deleted: string[] = []

    for (const [id, updatedAt] of currentSnapshot) {
      if (!previousSnapshot.has(id)) {
        added.push(id)
      } else if (previousSnapshot.get(id) !== updatedAt) {
        updated.push(id)
      }
    }

    for (const id of previousSnapshot.keys()) {
      if (!currentSnapshot.has(id)) {
        deleted.push(id)
      }
    }

    if (added.length === 0 && updated.length === 0 && deleted.length === 0) {
      return // 无变更
    }

    console.log(
      `[TopicSync] Changes: +${added.length} ~${updated.length} -${deleted.length}`
    )

    // 处理新增 + 更新：获取完整数据并上传
    const toUpload = [...added, ...updated]
    if (toUpload.length > 0) {
      // 分批上传
      for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
        const batch = toUpload.slice(i, i + BATCH_SIZE)
        const topicsData: TopicFullData[] = []

        for (const id of batch) {
          const data = await getTopicFullData(id)
          if (data) topicsData.push(data)
        }

        if (topicsData.length === 1) {
          await apiPost('/api/topics', topicsData[0])
        } else if (topicsData.length > 1) {
          await apiPost('/api/topics/batch', { topics: topicsData })
        }
      }
    }

    // 处理删除
    for (const id of deleted) {
      await apiDelete(`/api/topics/${id}`)
    }

    // 更新快照（内存 + 持久化）
    previousSnapshot = currentSnapshot
    savePersistedSnapshot(currentSnapshot)
  } catch (e) {
    console.error('[TopicSync] Sync loop error:', e)
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────

function start() {
  const { server } = getConfig()
  if (!server) {
    console.log('[TopicSync] No sync server configured. Set .env RENDERER_VITE_SYNC_SERVER or localStorage "cherry-sync-server".')
    return
  }

  console.log(`[TopicSync] Starting sync to ${server}, interval=${SYNC_INTERVAL}ms`)

  // 立即执行一次（建立基线）
  syncOnce()

  // 定时同步
  setInterval(syncOnce, SYNC_INTERVAL)
}

setTimeout(start, INIT_DELAY)
