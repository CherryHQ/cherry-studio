import { relative, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { readConfig } from '@changesets/config'
import { readChangesets } from '@changesets/read'
import { getPackages } from '@manypkg/get-packages'

import { collectChangeScope } from '../docsGovernance/change-scope.mjs'

try {
  const cwd = process.cwd()
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  const workspace = await getPackages(cwd)
  const { config, errors } = await readConfig(cwd, workspace)
  if (errors) throw new Error(errors.join('\n'))

  const packages = new Map([workspace.rootPackage, ...workspace.packages].map((pkg) => [pkg.packageJson.name, pkg]))
  const changedPaths = values.base
    ? new Set(Object.values(collectChangeScope({ base: values.base }, cwd).paths).flat())
    : undefined
  const changesets = await readChangesets(cwd)
  const violations = changesets.flatMap(({ id, releases }) => {
    const file = `.changeset/${id}.md`
    return releases.flatMap(({ name }) => {
      const pkg = packages.get(name)
      if (!pkg) return [`${file} references unknown package: ${name}`]
      if (config.ignore.includes(name)) return [`${file} references ignored packages: ${name}`]
      if (pkg.packageJson.private) return [`${file} references private package: ${name}`]
      if (changedPaths?.has(file)) {
        const directory = `${relative(workspace.rootDir, pkg.dir).split(sep).join('/')}/`
        if (![...changedPaths].some((changed) => changed.startsWith(directory))) {
          return [`${file} references unchanged package: ${name} (base: ${values.base})`]
        }
      }
      return []
    })
  })
  if (violations.length) {
    throw new Error(
      `${violations.join('\n')}\nRemove invalid package entries; use an empty changeset when no package release is needed.`
    )
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
