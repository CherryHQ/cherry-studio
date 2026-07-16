import { isMainExternalModule } from '../../electron.vite.config'
import packageJson from '../../package.json'

describe('@mozilla/readability bundling contract', () => {
  it('keeps the pure-JavaScript package as a bundled devDependency', () => {
    expect(packageJson.devDependencies?.['@mozilla/readability']).toBeDefined()
    expect(packageJson.dependencies?.['@mozilla/readability']).toBeUndefined()
    expect(isMainExternalModule('@mozilla/readability')).toBe(false)
  })
})
