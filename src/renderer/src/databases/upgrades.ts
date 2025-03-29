import { Transaction } from 'dexie'

export async function upgradeToV5(tx: Transaction): Promise<void> {
  const topics = await tx.table('topics').toArray()
  const files = await tx.table('files').toArray()

  for (const file of files) {
    if (file.created_at instanceof Date) {
      file.created_at = file.created_at.toISOString()
      await tx.table('files').put(file)
    }
  }

  for (const topic of topics) {
    let hasChanges = false

    for (const message of topic.messages) {
      if (message?.metadata?.tavily) {
        hasChanges = true
        const tavily = message.metadata.tavily
        delete message.metadata.tavily
        message.metadata.webSearch = {
          query: tavily.query,
          results:
            tavily.results?.map((i) => ({
              title: i.title,
              url: i.url,
              content: i.content
            })) || []
        }
      }
    }

    if (hasChanges) {
      await tx.table('topics').put(topic)
    }
  }
}

// 把消息中的 Model[] 转换为 MentionedAssistant[]
// 没有必要修复其中的 name 和 emoji
export async function upgradeToV6(tx: Transaction): Promise<void> {
  const topics = await tx.table('topics').toArray()

  for (const topic of topics) {
    let hasChanges = false

    for (const message of topic.messages) {
      if (message?.mentions && Array.isArray(message.mentions) && message.mentions.length > 0) {
        hasChanges = true

        message.mentions = message.mentions.map((model) => ({
          id: message.assistantId,
          name: '',
          model: model
        }))
      }
    }

    if (hasChanges) {
      await tx.table('topics').put(topic)
    }
  }
}

// 为每个 topic 添加时间戳,兼容老数据,默认按照最新的时间戳来,不确定是否要加
export async function upgradeToV7(tx: Transaction): Promise<void> {
  const topics = await tx.table('topics').toArray()

  // 为每个 topic 添加时间戳,兼容老数据,默认按照最新的时间戳来
  const now = new Date().toISOString()
  for (const topic of topics) {
    if (!topic.createdAt && !topic.updatedAt) {
      await tx.table('topics').update(topic.id, {
        createdAt: now,
        updatedAt: now
      })
    }
  }
}
