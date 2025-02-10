import { Client } from '@notionhq/client'
import db from '@renderer/databases'
import store from '@renderer/store'
import { Message, Topic } from '@renderer/types'

export const messageToMarkdown = (message: Message) => {
  const roleText = message.role === 'user' ? '🧑‍💻 User' : '🤖 Assistant'
  const titleSection = `### ${roleText}`
  const contentSection = message.content

  return [titleSection, '', contentSection].join('\n')
}

export const messagesToMarkdown = (messages: Message[]) => {
  return messages.map((message) => messageToMarkdown(message)).join('\n\n---\n\n')
}

export const topicToMarkdown = async (topic: Topic) => {
  const topicName = `# ${topic.name}`
  const topicMessages = await db.topics.get(topic.id)

  if (topicMessages) {
    return topicName + '\n\n' + messagesToMarkdown(topicMessages.messages)
  }

  return ''
}

export const exportTopicAsMarkdown = async (topic: Topic) => {
  const fileName = topic.name + '.md'
  const markdown = await topicToMarkdown(topic)
  window.api.file.save(fileName, markdown)
}

export const exportTopicToNotion = async (topic: Topic) => {

  const { notionDatabaseID, notionApiKey } = store.getState().settings
  if (!notionApiKey || !notionDatabaseID) {
    window.message.error({ content: 'API Key 或 Database ID 不能为空', key: 'notion-error' })
    return
  }
  try {
    const notion = new Client({ auth: notionApiKey });
    const markdown = await topicToMarkdown(topic);
    const requestBody = JSON.stringify({ md: markdown })

    const res = await fetch('https://md2notion.hilars.dev', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json'
       },
       body: requestBody
     });

     const data = await res.json();
     const notionBlocks = data; 

    const response = await notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        Name: {
          title: [{ text: { content: topic.name } }]
        }
      },
      children: notionBlocks // 使用转换后的块
    });

    window.message.success({ content: `成功导入到 Notion，页面ID: ${response.id}`, key: 'notion-success' });
    return response;

  } catch (error:any) {
    console.error("Notion API 调用失败:", error);  // 打印详细错误信息
    window.message.error({ content: `Notion 导入失败: ${error.message}`, key: 'notion-error' }); // 显示错误信息
    return null; // 或者抛出错误，根据你的需求决定
  }
};
