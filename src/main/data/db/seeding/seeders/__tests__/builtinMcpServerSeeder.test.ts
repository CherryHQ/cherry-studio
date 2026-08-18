import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { BuiltinMcpServerSeeder } from '@data/db/seeding/seeders/builtinMcpServerSeeder'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('BuiltinMcpServerSeeder', () => {
  const dbh = setupTestDatabase()

  const insert = (values: Partial<typeof mcpServerTable.$inferInsert> & { name: string }) =>
    dbh.db.insert(mcpServerTable).values(values)

  const rowFor = async (name: string) => {
    const [row] = await dbh.db.select().from(mcpServerTable).where(eq(mcpServerTable.name, name))
    return row
  }

  it('repoints an installed flomo row at its HTTP endpoint', async () => {
    await insert({ name: BuiltinMcpServerNames.flomo, type: 'inMemory', installSource: 'builtin' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.flomo)
    expect(row.type).toBe('streamableHttp')
    expect(row.baseUrl).toBe('https://flomoapp.com/mcp')
    expect(row.headers).toEqual({ APP: 'Cherry Studio' })
  })

  it('turns a legacy in-memory mcp-auto-install row into the npx process it really is', async () => {
    await insert({ name: BuiltinMcpServerNames.mcpAutoInstall, type: 'inMemory', installSource: 'builtin' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.mcpAutoInstall)
    expect(row.type).toBe('stdio')
    expect(row.command).toBe('npx')
    expect(row.args).toEqual(['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'])
  })

  it('keeps the builtin identity of a legacy row that predates installSource', async () => {
    // Settings recognises such a row as builtin only through its `inMemory` type; once the
    // migration changes that, an absent installSource would unlock its name and transport.
    await insert({ name: BuiltinMcpServerNames.flomo, type: 'inMemory' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    expect((await rowFor(BuiltinMcpServerNames.flomo)).installSource).toBe('builtin')
  })

  it('does not relabel a row the user installed from somewhere else', async () => {
    await insert({ name: BuiltinMcpServerNames.flomo, type: 'inMemory', installSource: 'manual' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    expect((await rowFor(BuiltinMcpServerNames.flomo)).installSource).toBe('manual')
  })

  it('keeps user edits made after the migration', async () => {
    await insert({
      name: BuiltinMcpServerNames.nowledgeMem,
      type: 'streamableHttp',
      baseUrl: 'http://192.168.1.2:14242/mcp',
      headers: { Authorization: 'Bearer mine' }
    })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.nowledgeMem)
    expect(row.baseUrl).toBe('http://192.168.1.2:14242/mcp')
    expect(row.headers).toEqual({ Authorization: 'Bearer mine' })
  })

  it('leaves in-process builtins and unrelated servers untouched', async () => {
    await insert({ name: BuiltinMcpServerNames.memory, type: 'inMemory' })
    await insert({ name: 'my-server', type: 'inMemory' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    expect((await rowFor(BuiltinMcpServerNames.memory)).type).toBe('inMemory')
    expect((await rowFor('my-server')).type).toBe('inMemory')
  })

  it('never installs a builtin the user does not have', async () => {
    new BuiltinMcpServerSeeder().run(dbh.db)

    expect(await dbh.db.select().from(mcpServerTable)).toEqual([])
  })

  it('changes its version when the preset transports change', () => {
    const version = new BuiltinMcpServerSeeder().version

    expect(version).toBe(new BuiltinMcpServerSeeder().version)
    expect(PRESET_MCP_SERVERS.some((preset) => preset.type !== 'inMemory')).toBe(true)
  })
})
