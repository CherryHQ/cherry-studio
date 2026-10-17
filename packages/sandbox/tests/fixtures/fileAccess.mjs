import { readFileSync, writeFileSync } from 'node:fs'

const [operation, path, content] = process.argv.slice(1)
try {
  if (operation === 'read') process.stdout.write(readFileSync(path))
  else if (operation === 'write') writeFileSync(path, content)
  else throw new Error('Unknown operation')
} catch (error) {
  if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error
  process.stdout.write('PERMISSION_DENIED\n')
  process.exitCode = 77
}
