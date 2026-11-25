import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, it } from 'vitest'

import { confirmed, input } from './fixture'
import { nativeFixture, observeNative, type NativeHarness } from './nativeFixture'

for (const harness of ['claude', 'gemini'] satisfies NativeHarness[]) {
  const executable = harness === 'claude' ? process.env.ACP_CLAUDE_BIN : process.env.ACP_GEMINI_BIN
  it.skipIf(!executable || process.platform === 'win32')(
    `${harness}: native conversation, tool permission, cancellation and history reload`,
    async () => {
      const f = await nativeFixture(harness, executable!)
      try {
        const runtime = f.runtime()
        const handle = confirmed(await runtime.create(f.configuration))
        const view = await observeNative(handle)
        if (harness === 'claude') confirmed(await handle.acp.setMode('default'))
        expect(await handle.input!.submit(input('ACP native conversation', 'conversation'))).toMatchObject({
          status: 'acknowledged'
        })
        const first = await f.request()
        first.response.text('Native model answer')
        first.response.end()
        await view.outcome('conversation', 'completed')
        expect(JSON.stringify(view.snapshot().messages)).toContain('Native model answer')

        const file = path.join(f.cwd, 'permission.txt')
        await handle.input!.submit(input('ACP native tool', 'tool'))
        const tool = await f.request()
        tool.response.tool(file)
        tool.response.end(true)
        const continuation = await f.request()
        expect(f.permissions.length).toBeGreaterThan(0)
        expect(await readFile(file, 'utf8')).toBe('native tool evidence')
        continuation.response.text('Tool finished')
        continuation.response.end()
        await view.outcome('tool', 'completed')

        await handle.input!.submit(input('ACP native cancel', 'cancel'))
        const pending = await f.request()
        pending.response.text('Before cancellation')
        expect(await handle.interrupt!()).toMatchObject({ status: 'confirmed' })
        await view.outcome('cancel', 'aborted')
        const thread = handle.thread
        expect(await runtime.shutdown()).toMatchObject({ status: 'confirmed' })

        const reopened = confirmed(await f.runtime().open(thread))
        const history = await observeNative(reopened)
        await expect
          .poll(() => JSON.stringify(history.snapshot().messages), { timeout: 5000 })
          .toContain('Native model answer')
        await expect
          .poll(() => JSON.stringify(history.snapshot().messages), { timeout: 5000 })
          .toContain('Tool finished')
      } catch (error) {
        throw new Error(`${String(error)}\n${JSON.stringify(f.diagnostics())}`, { cause: error })
      } finally {
        await f.close()
      }
    },
    90000
  )
}
