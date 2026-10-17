import { readConfig } from '@changesets/config'
import { readChangesets } from '@changesets/read'

try {
  const cwd = process.cwd()
  const { config, errors } = await readConfig(cwd)
  if (errors) throw new Error(errors.join('\n'))

  const changesets = await readChangesets(cwd)
  const violations = changesets.flatMap(({ id, releases }) => {
    const ignored = releases.filter(({ name }) => config.ignore.includes(name))
    return ignored.length
      ? [`.changeset/${id}.md references ignored packages: ${ignored.map(({ name }) => name).join(', ')}`]
      : []
  })
  if (violations.length) {
    throw new Error(
      `${violations.join('\n')}\nRemove these package entries (or the changeset if none remain). Ignored changesets survive versioning and block npm publication.`
    )
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
