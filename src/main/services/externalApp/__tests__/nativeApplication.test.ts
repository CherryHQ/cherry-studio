import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { listNativeApplications } from '../nativeApplication'

describe('native application listing boundary', () => {
  let fixtureDirectory: string
  const target = AbsoluteFilePathSchema.parse(path.resolve('README.md'))

  beforeEach(async () => {
    fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'native-application-boundary-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(fixtureDirectory, { recursive: true, force: true })
  })

  async function installFixture(source: string): Promise<void> {
    const fixture = path.join(fixtureDirectory, 'addon.cjs')
    await writeFile(fixture, source)
    vi.spyOn(application, 'getPath').mockReturnValue(fixture)
  }

  it('validates async results while retaining the addon method receiver and target', async () => {
    await installFixture(`
      module.exports = {
        open: async function () {},
        list: async function (target) {
          if (typeof this.open !== 'function') throw new Error('lost addon receiver');
          return {
            applications: [{ id: 'fixture', name: target, extra: 'not public' }],
            defaultApplication: { id: '', name: 'System default' }
          };
        }
      };
    `)

    await expect(listNativeApplications(target)).resolves.toEqual({
      applications: [{ id: 'fixture', name: target }],
      defaultApplication: { id: '', name: 'System default' }
    })
  })

  it.each([
    {
      result: { applications: [{ id: '', name: 'Broken identity' }], defaultApplication: null },
      invalidPath: ['applications', 0, 'id']
    },
    {
      result: { applications: [{ id: 'fixture', name: '' }], defaultApplication: null },
      invalidPath: ['applications', 0, 'name']
    },
    {
      result: { applications: [], defaultApplication: { id: '', name: 'Default', iconDataUrl: 'invalid' } },
      invalidPath: ['defaultApplication', 'iconDataUrl']
    }
  ])('rejects malformed asynchronous native results: %j', async ({ result, invalidPath }) => {
    await installFixture(`module.exports = {
      open: async function () {},
      list: async function () { return ${JSON.stringify(result)}; }
    };`)

    await expect(listNativeApplications(target)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: invalidPath })])
    })
  })

  it('propagates native discovery failures', async () => {
    await installFixture(`module.exports = {
      open: async function () {},
      list: async function () { throw new Error('native discovery failed'); }
    };`)

    await expect(listNativeApplications(target)).rejects.toThrow('native discovery failed')
  })
})
