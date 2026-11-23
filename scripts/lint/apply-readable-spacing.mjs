import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

import ts from 'typescript'

const parsed = ts.parseConfigFileTextToJson('.oxlintrc.json', readFileSync('.oxlintrc.json', 'utf8'))

if (parsed.error) throw new Error('Unable to read .oxlintrc.json')

const config = parsed.config
const rule = 'anti-slop/require-readable-spacing'

config.categories = Object.fromEntries(
  ['correctness', 'suspicious', 'pedantic', 'perf', 'style', 'restriction', 'nursery'].map((category) => [
    category,
    'off'
  ])
)

config.rules = Object.fromEntries(Object.keys(config.rules).map((name) => [name, 'off']))

config.rules[rule] = 'error'

for (const override of config.overrides ?? []) {
  for (const name of Object.keys(override.rules ?? {})) {
    if (name !== rule) override.rules[name] = 'off'
  }
}

const temporaryConfig = `.oxlintrc.readable-spacing-fix-${process.pid}.json`

writeFileSync(temporaryConfig, JSON.stringify(config))

try {
  const result = spawnSync(process.execPath, ['node_modules/oxlint/bin/oxlint', '--config', temporaryConfig, '--fix'], {
    stdio: 'inherit'
  })

  if (result.error) throw result.error

  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temporaryConfig)
}
