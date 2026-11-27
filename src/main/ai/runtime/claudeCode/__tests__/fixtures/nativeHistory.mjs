import {
  getSessionMessages,
  getSubagentMessages,
  importSessionToStore,
  listSubagents
} from '@anthropic-ai/claude-agent-sdk'

const [sessionId, cwd] = process.argv.slice(2)
const children = await listSubagents(sessionId, { dir: cwd })
const entries = []
await importSessionToStore(
  sessionId,
  {
    async append(key, batch) {
      if (!key.subpath) entries.push(...batch)
    },
    async load() {
      return null
    }
  },
  { dir: cwd, includeSubagents: false }
)
const history = {
  entries,
  root: await getSessionMessages(sessionId, { dir: cwd }),
  children: Object.fromEntries(
    await Promise.all(children.map(async (id) => [id, await getSubagentMessages(sessionId, id, { dir: cwd })]))
  )
}
process.stdout.write(JSON.stringify(history))
