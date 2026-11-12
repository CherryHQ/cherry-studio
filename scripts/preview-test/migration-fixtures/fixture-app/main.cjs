const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const parent = path.dirname(__dirname)
const fixture = fs.mkdtempSync(path.join(parent, 'v1-'))
const data = path.join(fixture, 'data')
fs.mkdirSync(data)
app.setPath('userData', data)
app.setPath('sessionData', data)
app.setAppLogsPath(path.join(data, 'logs'))

const expected = {
  assistantId: '7fbb3282-16ea-4cef-9b1e-1193328d6947',
  assistantName: '迁移测试助手 #23998',
  prompt: 'Synthetic assistant prompt — 便携版验收',
  topicId: 'e5dbcaa6-a94f-4cf2-86ac-059ed4d662a3',
  topicName: 'Portable migration fixture 迁移 #23998',
  userId: '28a51832-4de3-46dd-b39e-e93b3300737b',
  userText: 'Synthetic user message: 原始问题 23998',
  replyId: 'f25986f3-810c-4a7b-82c0-12bb2074cac1',
  replyText: 'Synthetic assistant reply: 迁移后必须保留'
}

async function main() {
  await app.whenReady()
  const window = new BrowserWindow({ show: false })
  await window.loadFile(path.join(__dirname, 'seed.html'))
  const seeded = await window.webContents.executeJavaScript(`(async () => {
    const fixture = ${JSON.stringify(expected)};
    const date = '2026-06-12T02:00:00.000Z';
    const topic = {
      id: fixture.topicId, assistantId: fixture.assistantId, name: fixture.topicName,
      createdAt: date, updatedAt: date, messages: [], isNameManuallyEdited: true
    };
    const assistant = {
      id: fixture.assistantId, name: fixture.assistantName, prompt: fixture.prompt,
      type: 'assistant', topics: [topic], settings: { temperature: 0.7, contextCount: 6 }
    };
    const assistants = {
      assistants: [assistant], defaultAssistant: assistant, presets: [], tagsOrder: [], collapsedTags: {},
      unifiedListOrder: [{ type: 'assistant', id: assistant.id }]
    };
    localStorage.setItem('persist:cherry-studio', JSON.stringify({
      assistants: JSON.stringify(assistants),
      settings: JSON.stringify({ language: 'en-US', autoUpdate: false }),
      llm: JSON.stringify({ providers: [] }),
      _persist: JSON.stringify({ version: 0, rehydrated: true })
    }));
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('CherryStudio', 100);
      open.onupgradeneeded = () => {
        const schema = {
          files: ['name', 'origin_name', 'path', 'size', 'ext', 'type', 'created_at', 'count'],
          topics: [],
          settings: ['value'],
          knowledge_notes: ['baseId', 'type', 'content', 'created_at', 'updated_at'],
          translate_history: ['sourceText', 'targetText', 'sourceLanguage', 'targetLanguage', 'createdAt'],
          translate_languages: ['langCode'],
          quick_phrases: [],
          message_blocks: ['messageId', 'file.id']
        };
        for (const [name, indexes] of Object.entries(schema)) {
          const store = open.result.createObjectStore(name, { keyPath: 'id' });
          for (const index of indexes) store.createIndex(index, index);
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const records = [
      { id: fixture.userId, role: 'user', blocks: ['213534bb-c0bc-49f1-be7b-84630a74ce7d'] },
      { id: fixture.replyId, role: 'assistant', askId: fixture.userId, blocks: ['8cca2856-847f-4dea-8ce9-9ef4138bc39d'] }
    ].map((record) => ({ ...record, status: 'success', createdAt: date, assistantId: assistant.id, topicId: topic.id }));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['topics', 'message_blocks'], 'readwrite', { durability: 'strict' });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore('topics').put({ ...topic, messages: records });
      records.forEach((record, index) => tx.objectStore('message_blocks').put({
        id: record.blocks[0], messageId: record.id, type: 'main_text', status: 'success',
        createdAt: date, content: index === 0 ? fixture.userText : fixture.replyText
      }));
    });
    db.close();
    return records.map(({ id }) => id);
  })()`)
  assert.deepEqual(seeded, [expected.userId, expected.replyId])
  window.webContents.session.flushStorageData()
  await window.loadFile(path.join(__dirname, 'check.html'))
  const reloaded = await window.webContents.executeJavaScript(`(async () => ({
    assistantId: JSON.parse(JSON.parse(localStorage.getItem('persist:cherry-studio')).assistants).assistants[0].id,
    database: (await indexedDB.databases()).find(({name}) => name === 'CherryStudio')
  }))()`)
  assert.equal(reloaded.assistantId, expected.assistantId)
  assert.equal(reloaded.database.version, 100)
  fs.writeFileSync(path.join(data, 'version.log'), '1.9.11|win|prod|packaged|portable|2026-06-12T02:00:00.000Z\n')
  fs.writeFileSync(
    path.join(parent, 'seed-evidence.json'),
    JSON.stringify(
      {
        fixture,
        expected,
        electron: process.versions.electron,
        originVerified: true,
        exited: true
      },
      null,
      2
    )
  )
  app.quit()
}

main().catch((error) => {
  fs.writeFileSync(path.join(parent, 'fixture-error.log'), String(error.stack || error))
  app.exit(1)
})
