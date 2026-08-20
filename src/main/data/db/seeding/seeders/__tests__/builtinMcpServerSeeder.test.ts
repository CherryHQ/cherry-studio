import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { hashObject } from '@data/db/seeding/hashObject'
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

  it('turns an installed in-memory mcp-auto-install row into the npx process it really is', async () => {
    await insert({
      name: BuiltinMcpServerNames.mcpAutoInstall,
      type: 'inMemory',
      installSource: 'builtin',
      baseUrl: 'https://stale.example/mcp',
      headers: { Authorization: 'Bearer stale' }
    })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.mcpAutoInstall)
    expect(row.type).toBe('stdio')
    expect(row.command).toBe('npx')
    expect(row.args).toEqual(['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'])
    expect(row.baseUrl).toBeNull()
    expect(row.headers).toBeNull()
  })

  it('migrates the exact mcp-auto-install shape that predates installSource', async () => {
    await insert({
      name: BuiltinMcpServerNames.mcpAutoInstall,
      type: 'inMemory',
      reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
      command: 'npx',
      args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
      provider: 'CherryAI'
    })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.mcpAutoInstall)
    expect(row.type).toBe('stdio')
    expect(row.installSource).toBe('builtin')
  })

  it('leaves a server the user owns alone even when its name collides with a builtin', async () => {
    await insert({ name: BuiltinMcpServerNames.flomo, type: 'inMemory', installSource: 'manual' })

    new BuiltinMcpServerSeeder().run(dbh.db)

    const row = await rowFor(BuiltinMcpServerNames.flomo)
    expect(row.type).toBe('inMemory')
    expect(row.baseUrl).toBeNull()
    expect(row.installSource).toBe('manual')
  })

  it('does not infer builtin ownership from a null installSource and matching name', async () => {
    await insert({ name: BuiltinMcpServerNames.flomo, type: 'inMemory' })
    await insert({
      name: BuiltinMcpServerNames.mcpAutoInstall,
      type: 'inMemory',
      command: 'npx',
      args: ['my-edited-package']
    })

    new BuiltinMcpServerSeeder().run(dbh.db)

    expect((await rowFor(BuiltinMcpServerNames.flomo)).type).toBe('inMemory')
    const edited = await rowFor(BuiltinMcpServerNames.mcpAutoInstall)
    expect(edited.type).toBe('inMemory')
    expect(edited.args).toEqual(['my-edited-package'])
    expect(edited.installSource).toBeNull()
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

  it('derives its version from the preset transports, so a change reruns the migration', () => {
    const repointed = PRESET_MCP_SERVERS.map((preset) =>
      preset.name === BuiltinMcpServerNames.flomo ? { ...preset, baseUrl: 'https://flomoapp.com/mcp/v2' } : preset
    )

    expect(new BuiltinMcpServerSeeder().version).toBe(hashObject(PRESET_MCP_SERVERS))
    expect(hashObject(repointed)).not.toBe(hashObject(PRESET_MCP_SERVERS))
  })
})
