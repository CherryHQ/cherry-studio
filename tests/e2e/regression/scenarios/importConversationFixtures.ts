export const importConversationFixtures = (source: 'ChatGPT' | 'Claude') => {
  const conversations = [
    {
      name: `MP-120 ${source} first conversation`,
      messages: ['你好，保留完整对话。', '第一条回答 preserved.', '再问一个问题。', '第二条回答 complete.']
    },
    {
      name: `MP-120 ${source} second conversation`,
      messages: ['Independent conversation question.', '独立对话回答。']
    }
  ]
  const records = conversations.map(({ name, messages }, index) =>
    source === 'ChatGPT'
      ? {
          title: name,
          create_time: 1767225600,
          current_node: `m${messages.length - 1}`,
          mapping: Object.fromEntries(
            messages.map((text, i) => [
              `m${i}`,
              {
                parent: i ? `m${i - 1}` : undefined,
                children: i + 1 < messages.length ? [`m${i + 1}`] : [],
                message: {
                  author: { role: i % 2 ? 'assistant' : 'user' },
                  content: { content_type: 'text', parts: [text] }
                }
              }
            ])
          )
        }
      : {
          uuid: `mp120-conversation-${index}`,
          name,
          summary: '',
          created_at: '2026-01-01T00:00:00.000Z',
          chat_messages: messages.map((text, i) => ({
            uuid: `mp120-message-${index}-${i}`,
            parent_message_uuid: i ? `mp120-message-${index}-${i - 1}` : null,
            sender: i % 2 ? 'assistant' : 'human',
            text,
            content: [{ type: 'text', text }]
          }))
        }
  )
  return {
    conversations,
    valid: JSON.stringify(records),
    invalid: JSON.stringify([records[0], { title: 'MP-120 invalid record', name: 'MP-120 invalid record' }])
  }
}
