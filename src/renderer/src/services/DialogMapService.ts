import db from '@renderer/databases'
import { DialogMap, DialogMapNode } from '@renderer/types'
import { AssistantMessageStatus, Message, UserMessageStatus } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { buildFullPath, findAncestors, findPathNodes } from '@renderer/utils/dialogMapUtils'

/**
 * 对话地图服务
 * 用于创建、查询和更新对话地图
 */
class DialogMapService {
  /**
   * 根据主题ID创建对话地图
   * @param topicId 主题ID
   * @returns 创建的对话地图
   */
  async createDialogMapFromTopic(topicId: string): Promise<DialogMap> {
    // 检查是否已存在此主题的对话地图
    const existingMap = await this.getDialogMapByTopicId(topicId)
    if (existingMap) {
      return existingMap
    }

    // 获取主题信息
    const topic = await db.topics.get(topicId)
    if (!topic) {
      throw new Error(`Topic with id ${topicId} not found`)
    }

    // 构建对话地图节点
    const nodes: Record<string, DialogMapNode> = {}
    let rootNodeId: string | null = null
    let previousNodeId: string | null = null

    // 按顺序处理消息，建立链式结构
    for (const message of topic.messages) {
      const nodeId = uuid()

      const node: DialogMapNode = {
        id: nodeId,
        messageId: message.id,
        parentId: previousNodeId,
        role: message.role,
        blocks: message.blocks,
        children: [],
        createdAt: message.createdAt,
        modelId: message.modelId,
        model: message.model
      }

      // 如果是第一个节点，设置为根节点
      if (!rootNodeId) {
        rootNodeId = nodeId
      }

      // 如果有前一个节点，将当前节点添加为其子节点
      if (previousNodeId) {
        nodes[previousNodeId].children.push(nodeId)
      }

      nodes[nodeId] = node
      previousNodeId = nodeId
    }

    if (!rootNodeId) {
      throw new Error('No root node found in the conversation')
    }

    // 创建对话地图
    const dialogMap: DialogMap = {
      id: uuid(),
      topicId,
      rootNodeId,
      nodes,
      selectedPath: Object.keys(nodes),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    // 保存到数据库
    await db.dialogMaps.put(dialogMap)

    return dialogMap
  }

  /**
   * 根据主题ID获取对话地图
   * @param topicId 主题ID
   * @returns 对话地图，如果不存在则返回null
   */
  async getDialogMapByTopicId(topicId: string): Promise<DialogMap | null> {
    const dialogMaps = await db.dialogMaps.where('topicId').equals(topicId).toArray()
    return dialogMaps.length > 0 ? dialogMaps[0] : null
  }

  /**
   * 根据选中的路径生成消息列表
   * @param dialogMap 对话地图
   * @param path 选中的路径
   * @returns 消息列表
   */
  async generateMessagesFromPath(dialogMap: DialogMap, path: string[]): Promise<Message[]> {
    if (!path.length) {
      return []
    }

    // 获取原始主题
    const topic = await db.topics.get(dialogMap.topicId)
    if (!topic) {
      throw new Error(`Topic with id ${dialogMap.topicId} not found`)
    }

    // 收集原始消息映射 (消息ID -> 消息)
    const messageMap = topic.messages.reduce(
      (map, msg) => {
        map[msg.id] = msg
        return map
      },
      {} as Record<string, Message>
    )

    // 根据路径收集节点
    const pathNodes = path
      .map((nodeId) => {
        return dialogMap.nodes[nodeId]
      })
      .filter(Boolean)

    // 按照路径顺序收集消息
    const messages = pathNodes
      .map((node) => {
        let message = messageMap[node.messageId]
        if (!message) {
          // 如果消息不存在，从节点信息创建消息
          message = {
            id: node.messageId,
            role: node.role,
            assistantId: node.modelId || '',
            topicId: dialogMap.topicId,
            createdAt: node.createdAt,
            modelId: node.modelId || '',
            model: node.model,
            status: node.role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
            blocks: []
          }
          // 将新创建的消息添加到主题中
          topic.messages.push(message)
          messageMap[node.messageId] = message
        }
        return message
      })
      .filter(Boolean)

    if (messages.length !== path.length) {
      // 如果生成的消息数量与路径节点数量不匹配，记录警告
      console.warn(`Warning: Generated ${messages.length} messages but path has ${path.length} nodes`)
    }

    // 更新主题消息
    await db.topics.put(topic)

    return messages
  }

  /**
   * 设置选中的路径
   * @param dialogMapId 对话地图ID
   * @param path 选中的路径
   */
  async setSelectedPath(dialogMapId: string, path: string[]): Promise<DialogMap> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    dialogMap.selectedPath = path
    dialogMap.updatedAt = new Date().toISOString()

    // 更新选中状态
    Object.keys(dialogMap.nodes).forEach((nodeId) => {
      dialogMap.nodes[nodeId].isSelected = path.includes(nodeId)
    })

    await db.dialogMaps.put(dialogMap)

    return dialogMap
  }

  /**
   * 为节点添加新的子对话
   * @param dialogMapId 对话地图ID
   * @param parentNodeId 父节点ID
   * @param messages 要添加的消息
   */
  async addChildDialog(dialogMapId: string, parentNodeId: string, messages: Message[]): Promise<DialogMap> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    let currentParentId = parentNodeId

    // 处理新消息
    for (const message of messages) {
      const nodeId = uuid()

      const node: DialogMapNode = {
        id: nodeId,
        messageId: message.id,
        parentId: currentParentId,
        role: message.role,
        blocks: message.blocks,
        children: [],
        createdAt: message.createdAt,
        modelId: message.modelId,
        model: message.model
      }

      // 将当前节点添加到父节点的子节点列表
      if (currentParentId && dialogMap.nodes[currentParentId]) {
        dialogMap.nodes[currentParentId].children.push(nodeId)
      }

      dialogMap.nodes[nodeId] = node

      // 如果是用户消息，则下一条助手消息的父节点是它
      if (message.role === 'user') {
        currentParentId = nodeId
      }
    }

    dialogMap.updatedAt = new Date().toISOString()

    await db.dialogMaps.put(dialogMap)

    return dialogMap
  }

  /**
   * 更新对话地图，将新的对话路径合并到现有地图中
   * @param topicId 主题ID
   * @param newPath 新的对话路径（消息ID数组）
   * @returns 更新后的对话地图
   */
  async updateDialogMap(topicId: string, newPath: string[]): Promise<DialogMap> {
    // 获取现有对话地图
    const existingMap = await this.getDialogMapByTopicId(topicId)
    if (!existingMap) {
      throw new Error(`No dialog map found for topic ${topicId}`)
    }

    // 获取主题信息
    const topic = await db.topics.get(topicId)
    if (!topic) {
      throw new Error(`Topic with id ${topicId} not found`)
    }

    // 创建消息ID到消息的映射
    const messageMap = topic.messages.reduce(
      (map, msg) => {
        map[msg.id] = msg
        return map
      },
      {} as Record<string, Message>
    )

    // 找到新路径中第一个不在现有地图中的消息
    const firstNewMessageIndex = newPath.findIndex((msgId) => {
      return !Object.values(existingMap.nodes).some((node) => node.messageId === msgId)
    })

    if (firstNewMessageIndex === -1) {
      // 所有消息都已在地图中，直接返回现有地图
      return existingMap
    }

    // 找到新路径中最后一个在现有地图中的消息
    const lastExistingMessageIndex = firstNewMessageIndex - 1
    const lastExistingMessageId = newPath[lastExistingMessageIndex]

    // 找到对应的节点
    const lastExistingNode = Object.values(existingMap.nodes).find((node) => node.messageId === lastExistingMessageId)

    if (!lastExistingNode) {
      throw new Error(`Cannot find node for message ${lastExistingMessageId}`)
    }

    // 从新消息开始处理
    let currentParentId = lastExistingNode.id
    const newNodes: Record<string, DialogMapNode> = {}

    // 处理新消息
    for (let i = firstNewMessageIndex; i < newPath.length; i++) {
      const messageId = newPath[i]
      const message = messageMap[messageId]
      if (!message) {
        console.warn(`Message ${messageId} not found in topic messages`)
        continue
      }

      // 检查消息角色是否与父节点角色交替
      const parentNode = currentParentId ? existingMap.nodes[currentParentId] || newNodes[currentParentId] : null
      if (parentNode && parentNode.role === message.role) {
        // 如果角色相同，说明这是一个新的分支，需要找到最近的合适父节点
        let tempParentId: string | null = currentParentId
        while (tempParentId) {
          const node = existingMap.nodes[tempParentId] || newNodes[tempParentId]
          if (!node) break
          if (node.role !== message.role) {
            currentParentId = tempParentId
            break
          }
          tempParentId = node.parentId
        }
      }

      const nodeId = uuid()

      const node: DialogMapNode = {
        id: nodeId,
        messageId: message.id,
        parentId: currentParentId,
        role: message.role,
        blocks: message.blocks,
        children: [],
        createdAt: message.createdAt,
        modelId: message.modelId,
        model: message.model
      }

      // 将当前节点添加到父节点的子节点列表
      if (currentParentId) {
        const parentNode = existingMap.nodes[currentParentId] || newNodes[currentParentId]
        if (parentNode) {
          parentNode.children.push(nodeId)
        }
      }

      newNodes[nodeId] = node
      currentParentId = nodeId

      // 确保消息被添加到主题中
      if (!messageMap[message.id]) {
        topic.messages.push(message)
        messageMap[message.id] = message
      }
    }

    // 更新主题消息
    await db.topics.put(topic)

    // 合并新节点到现有地图
    const updatedMap: DialogMap = {
      ...existingMap,
      nodes: {
        ...existingMap.nodes,
        ...newNodes
      },
      updatedAt: new Date().toISOString()
    }

    // 保存更新后的地图
    await db.dialogMaps.put(updatedMap)

    return updatedMap
  }

  /**
   * 删除节点及其所有子孙节点
   * @param dialogMapId 对话地图ID
   * @param nodeId 要删除的节点ID
   * @returns 更新后的对话地图
   */
  async deleteNodeAndDescendants(dialogMapId: string, nodeId: string): Promise<DialogMap> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    // 获取要删除的节点
    const nodeToDelete = dialogMap.nodes[nodeId]
    if (!nodeToDelete) {
      throw new Error(`Node with id ${nodeId} not found in dialog map`)
    }

    // 不允许删除根节点
    if (nodeId === dialogMap.rootNodeId) {
      throw new Error('Cannot delete root node')
    }

    // 找到节点的父节点
    const parentNode = nodeToDelete.parentId ? dialogMap.nodes[nodeToDelete.parentId] : null
    if (!parentNode) {
      throw new Error(`Parent node not found for node ${nodeId}`)
    }

    // 检查是否为双节点卡片的情况
    const nodesToDelete = new Set<string>()
    if (nodeToDelete.role === 'user' && nodeToDelete.children.length === 1) {
      // 如果是用户节点且只有一个子节点，检查子节点是否为助手节点
      const childNode = dialogMap.nodes[nodeToDelete.children[0]]
      if (childNode && childNode.role === 'assistant') {
        // 将助手节点也加入删除集合
        nodesToDelete.add(childNode.id)
      }
    } else if (nodeToDelete.role === 'assistant' && parentNode.role === 'user' && parentNode.children.length === 1) {
      // 如果是助手节点，且其父节点是只有一个子节点的用户节点
      // 将用户节点也加入删除集合
      nodesToDelete.add(parentNode.id)
      // 更新父节点引用为用户节点的父节点
      const grandParentNode = parentNode.parentId ? dialogMap.nodes[parentNode.parentId] : null
      if (grandParentNode) {
        grandParentNode.children = grandParentNode.children.filter((id) => id !== parentNode.id)
      }
    }

    // 添加当前节点到删除集合
    nodesToDelete.add(nodeId)

    // 递归收集所有要删除的节点的子节点ID
    const collectNodesToDelete = (id: string, result: Set<string>): Set<string> => {
      const node = dialogMap.nodes[id]
      if (node && node.children.length > 0) {
        for (const childId of node.children) {
          if (!nodesToDelete.has(childId)) {
            // 避免重复处理已经标记要删除的节点
            result.add(childId)
            collectNodesToDelete(childId, result)
          }
        }
      }
      return result
    }

    // 对所有要删除的节点收集它们的子节点
    for (const id of nodesToDelete) {
      collectNodesToDelete(id, nodesToDelete)
    }

    // 保存当前选中路径中不被删除的节点
    let updatedSelectedPath = dialogMap.selectedPath.filter((id) => !nodesToDelete.has(id))

    // 从节点映射中删除节点
    nodesToDelete.forEach((id) => {
      delete dialogMap.nodes[id]
    })

    // 如果选中路径为空，则选择默认路径（从根节点到某个叶子节点）
    if (updatedSelectedPath.length === 0) {
      // 构建从根节点到某个叶子节点的路径
      const buildDefaultPath = (id: string, path: string[] = []): string[] => {
        path.push(id)
        const node = dialogMap.nodes[id]
        if (node && node.children.length > 0) {
          return buildDefaultPath(node.children[0], path)
        }
        return path
      }

      updatedSelectedPath = buildDefaultPath(dialogMap.rootNodeId)
    }

    // 更新节点的选中状态
    Object.values(dialogMap.nodes).forEach((node) => {
      node.isSelected = updatedSelectedPath.includes(node.id)
    })

    // 更新对话地图
    dialogMap.selectedPath = updatedSelectedPath
    dialogMap.updatedAt = new Date().toISOString()

    // 保存更新后的地图
    await db.dialogMaps.put(dialogMap)

    return dialogMap
  }

  /**
   * 获取指定节点的完整路径（祖先+子孙）
   * @param dialogMapId 对话地图ID
   * @param nodeId 节点ID
   * @returns 完整路径（节点ID数组）
   */
  async getNodeFullPath(dialogMapId: string, nodeId: string): Promise<string[]> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    return buildFullPath(dialogMap, nodeId)
  }

  /**
   * 获取节点的祖先路径
   * @param dialogMapId 对话地图ID
   * @param nodeId 节点ID
   * @returns 祖先路径（节点ID数组，从根节点到指定节点）
   */
  async getNodeAncestors(dialogMapId: string, nodeId: string): Promise<string[]> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    return findAncestors(dialogMap, nodeId)
  }

  /**
   * 查找并应用最佳路径
   * @param dialogMapId 对话地图ID
   * @param selectedNodeIds 当前选中的节点ID数组
   * @returns 更新后的对话地图
   */
  async findAndApplyOptimalPath(dialogMapId: string, selectedNodeIds: string[]): Promise<DialogMap> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    // 查找选中节点的最佳路径
    const optimalPath = findPathNodes(dialogMap, selectedNodeIds)

    // 应用路径
    dialogMap.selectedPath = optimalPath
    dialogMap.updatedAt = new Date().toISOString()

    // 更新节点选中状态
    Object.keys(dialogMap.nodes).forEach((nodeId) => {
      dialogMap.nodes[nodeId].isSelected = optimalPath.includes(nodeId)
    })

    await db.dialogMaps.put(dialogMap)

    return dialogMap
  }

  /**
   * 通知节点分支创建
   * @param dialogMapId 对话地图ID
   * @param nodeId 基于哪个节点创建新分支
   * @param topic 当前主题
   * @returns 处理后的完整祖先路径
   */
  async notifyBranchCreation(dialogMapId: string, nodeId: string): Promise<string[]> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    // 获取到节点的祖先路径
    const ancestors = findAncestors(dialogMap, nodeId)

    // 更新选中路径
    await this.setSelectedPath(dialogMap.id, ancestors)

    return ancestors
  }

  /**
   * 处理路径变更并生成消息
   * @param dialogMapId 对话地图ID
   * @param path 新路径
   * @returns 生成的消息数组
   */
  async processPathChangeAndGenerateMessages(dialogMapId: string, path: string[]): Promise<Message[]> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    // 设置新的选中路径
    await this.setSelectedPath(dialogMapId, path)

    // 生成消息
    return this.generateMessagesFromPath(dialogMap, path)
  }

  /**
   * 创建一个新的默认选择路径
   * @param dialogMapId 对话地图ID
   * @returns 默认路径（节点ID数组）
   */
  async createDefaultPath(dialogMapId: string): Promise<string[]> {
    const dialogMap = await db.dialogMaps.get(dialogMapId)
    if (!dialogMap) {
      throw new Error(`DialogMap with id ${dialogMapId} not found`)
    }

    // 构建从根节点到某个叶子节点的路径
    const buildDefaultPath = (id: string, path: string[] = []): string[] => {
      path.push(id)
      const node = dialogMap.nodes[id]
      if (node && node.children.length > 0) {
        return buildDefaultPath(node.children[0], path)
      }
      return path
    }

    const defaultPath = buildDefaultPath(dialogMap.rootNodeId)
    await this.setSelectedPath(dialogMapId, defaultPath)

    return defaultPath
  }
}

export default new DialogMapService()
