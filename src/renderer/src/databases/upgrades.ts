import { Transaction } from 'dexie'

export async function upgradeToV5(tx: Transaction): Promise<void> {
  const topics = await tx.table('topics').toArray()

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
