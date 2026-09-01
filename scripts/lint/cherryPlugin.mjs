import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const FIXTURE_DIR = path.join(import.meta.dirname, '__fixtures__')
const FIXTURE_MARKER = '/scripts/lint/__fixtures__/'

const toPosix = (value) => value.split(path.sep).join('/')

const repoRelative = (filename) => {
  const normalized = toPosix(filename)
  const fixtureIndex = normalized.indexOf(FIXTURE_MARKER)
  if (fixtureIndex !== -1) {
    return normalized.slice(fixtureIndex + FIXTURE_MARKER.length).replace(/^(?:positive|negative)\//, '')
  }
  return toPosix(path.relative(REPO_ROOT, filename))
}

const filenameFor = (context) => context.filename ?? context.getFilename()

const importSource = (node) => {
  const value = node?.source?.value
  return typeof value === 'string' ? value : null
}

const resolveRepoImport = (specifier, fromRelative) => {
  const fromProcess = fromRelative.startsWith('src/main/') ? 'main' : 'renderer'
  let target

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = path.posix.resolve(path.posix.dirname(`/${fromRelative}`), specifier).slice(1)
  } else if (specifier === '@renderer') {
    target = 'src/renderer'
  } else if (specifier.startsWith('@renderer/')) {
    target = `src/renderer/${specifier.slice('@renderer/'.length)}`
  } else if (specifier === '@main') {
    target = 'src/main'
  } else if (specifier.startsWith('@main/')) {
    target = `src/main/${specifier.slice('@main/'.length)}`
  } else if (specifier === '@shared') {
    target = 'src/shared'
  } else if (specifier.startsWith('@shared/')) {
    target = `src/shared/${specifier.slice('@shared/'.length)}`
  } else if (specifier === '@data') {
    target = `src/${fromProcess}/data`
  } else if (specifier.startsWith('@data/')) {
    target = `src/${fromProcess}/data/${specifier.slice('@data/'.length)}`
  } else {
    return null
  }

  return path.posix.normalize(target).replace(/\.(?:[cm]?[jt]sx?)$/, '')
}

const importVisitors = (check) => ({
  ImportDeclaration(node) {
    const source = importSource(node)
    if (source) check(node, source)
  },
  ExportNamedDeclaration(node) {
    const source = importSource(node)
    if (source) check(node, source)
  },
  ExportAllDeclaration(node) {
    const source = importSource(node)
    if (source) check(node, source)
  },
  ImportExpression(node) {
    const value = node.source?.value
    if (typeof value === 'string') check(node, value)
  }
})

const isInside = (candidate, directory) => candidate === directory || candidate.startsWith(`${directory}/`)

const rendererBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      sharedReverse:
        'Shared buckets must not import pages/windows (reverse layer edge). docs/references/architecture/renderer.md §7.',
      utilsComponent:
        'utils/ is stateless and may call downward infra (data/ipc) but must not import components/hooks or any higher app layer. docs/references/architecture/renderer.md §3.',
      utilsService:
        'utils/ must not import renderer services (except @logger). docs/references/architecture/renderer.md §3.',
      serviceBarrel:
        'Renderer service topics are closed barrels — import the topic index, not an internal module. docs/references/architecture/renderer.md §3.1/§5.'
    }
  },
  create(context) {
    const importer = repoRelative(filenameFor(context))
    if (!importer.startsWith('src/renderer/')) return {}

    const check = (node, specifier) => {
      const target = resolveRepoImport(specifier, importer)
      if (!target?.startsWith('src/renderer/')) return

      const sharedBuckets = ['components', 'hooks', 'services', 'utils']
      const importerBucket = sharedBuckets.find((bucket) => isInside(importer, `src/renderer/${bucket}`))
      if (importerBucket && (isInside(target, 'src/renderer/pages') || isInside(target, 'src/renderer/windows'))) {
        context.report({ node, messageId: 'sharedReverse' })
        return
      }

      if (importerBucket === 'utils') {
        if (isInside(target, 'src/renderer/components') || isInside(target, 'src/renderer/hooks')) {
          context.report({ node, messageId: 'utilsComponent' })
          return
        }
        if (
          isInside(target, 'src/renderer/services') &&
          target !== 'src/renderer/services/LoggerService' &&
          !target.startsWith('src/renderer/services/LoggerService/')
        ) {
          context.report({ node, messageId: 'utilsService' })
          return
        }
      }

      const serviceMatch = /^src\/renderer\/services\/([^/]+)(?:\/(.+))?$/.exec(target)
      if (!serviceMatch?.[2]) return
      const topicRoot = `src/renderer/services/${serviceMatch[1]}`
      if (!isInside(importer, topicRoot)) context.report({ node, messageId: 'serviceBarrel' })
    }

    return importVisitors(check)
  }
}

const pageBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      pageWindow: 'A page must not import a window (reverse edge). docs/references/architecture/renderer.md §2/§7.',
      pageSibling:
        'A page must not import another page (cross-page coupling). docs/references/architecture/renderer.md §7.'
    }
  },
  create(context) {
    const importer = repoRelative(filenameFor(context))
    if (!isInside(importer, 'src/renderer/pages')) return {}

    const check = (node, specifier) => {
      const target = resolveRepoImport(specifier, importer)
      if (!target?.startsWith('src/renderer/')) return

      if (isInside(target, 'src/renderer/windows')) {
        context.report({ node, messageId: 'pageWindow' })
        return
      }

      if (!isInside(target, 'src/renderer/pages')) return
      const importerDomain = importer.split('/')[3]
      const targetDomain = target.split('/')[3]
      if (importerDomain && targetDomain && importerDomain !== targetDomain) {
        context.report({ node, messageId: 'pageSibling' })
      }
    }

    return importVisitors(check)
  }
}

const stripCodeComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const isPureReexportIndex = (content) => {
  if (!/\bexport\b[^;]*?\bfrom[ \t]*['"]/.test(content)) return false
  const rest = stripCodeComments(content)
    .replace(/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?from[ \t]*['"][^'"]+['"];?/g, '\n')
    .replace(/(?:^|\n)[ \t]*import[ \t]*['"][^'"]+['"];?/g, '\n')
  return !/\bexport\b/.test(rest)
}

const collectIndexFiles = (directory, output = []) => {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return output
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__mocks__') continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collectIndexFiles(entryPath, output)
    else if (entry.name === 'index.ts') output.push(entryPath)
  }
  return output
}

const BARREL_DIRS = new Set()
const indexFiles = [
  ...collectIndexFiles(SRC_DIR),
  ...collectIndexFiles(path.join(FIXTURE_DIR, 'positive', 'src')),
  ...collectIndexFiles(path.join(FIXTURE_DIR, 'negative', 'src'))
]
for (const indexFile of indexFiles) {
  try {
    if (isPureReexportIndex(fs.readFileSync(indexFile, 'utf8'))) BARREL_DIRS.add(path.dirname(indexFile))
  } catch {}
}

const BARREL_DIRS_DEEPEST_FIRST = [...BARREL_DIRS].sort((left, right) => right.length - left.length)
const BARREL_DIRS_SHALLOWEST_FIRST = [...BARREL_DIRS_DEEPEST_FIRST].reverse()
const BARREL_RESOLVE_CACHE = new Map()

const resolveBarrelImport = (specifier, fromFile) => {
  const cacheKey = `${fromFile}\0${specifier}`
  if (BARREL_RESOLVE_CACHE.has(cacheKey)) return BARREL_RESOLVE_CACHE.get(cacheKey)

  const relativeFrom = repoRelative(fromFile)
  const relativeTarget = resolveRepoImport(specifier, relativeFrom)
  const isFixture = toPosix(fromFile).includes(FIXTURE_MARKER)
  let base = relativeTarget && !isFixture ? path.join(REPO_ROOT, relativeTarget) : null
  if ((isFixture || !base) && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    base = path.resolve(path.dirname(fromFile), specifier)
  }

  let resolved = null
  if (base) {
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      base
    ]) {
      try {
        if (fs.statSync(candidate).isFile()) {
          resolved = candidate
          break
        }
      } catch {}
    }
  }

  BARREL_RESOLVE_CACHE.set(cacheKey, resolved)
  return resolved
}

const innermostBarrelDir = (filename) =>
  BARREL_DIRS_DEEPEST_FIRST.find(
    (directory) => filename === directory || filename.startsWith(`${directory}${path.sep}`)
  ) ?? null

const outermostCrossedBarrelDir = (target, importer) =>
  BARREL_DIRS_SHALLOWEST_FIRST.find(
    (directory) =>
      target.startsWith(`${directory}${path.sep}`) &&
      importer !== directory &&
      !importer.startsWith(`${directory}${path.sep}`)
  ) ?? null

const noExportStar = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        'No `export *` — use explicit named re-exports (docs/references/architecture/naming-conventions.md §6.4).'
    }
  },
  create(context) {
    return {
      ExportAllDeclaration(node) {
        if (node.source) context.report({ node, messageId: 'forbidden' })
      }
    }
  }
}

const indexNoImplementation = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      statement: 'A barrel is pure re-export — move top-level logic to a named file.',
      sideEffect: 'A barrel is pure re-export — side-effect imports belong in a named module.',
      defaultExport: 'A barrel must not contain a default implementation.',
      declaration: 'A barrel must not declare local values or types.',
      localExport: 'A barrel must re-export from another module, not export local bindings.'
    }
  },
  create(context) {
    if (!/[\\/]index\.ts$/.test(filenameFor(context))) return {}
    return {
      Program(node) {
        const statement = node.body.find((item) => !/^(?:Import|Export)/.test(item.type))
        if (statement) context.report({ node: statement, messageId: 'statement' })
      },
      ImportDeclaration(node) {
        if (!node.specifiers.length) context.report({ node, messageId: 'sideEffect' })
      },
      ExportDefaultDeclaration(node) {
        context.report({ node, messageId: 'defaultExport' })
      },
      ExportNamedDeclaration(node) {
        if (node.declaration) context.report({ node, messageId: 'declaration' })
        else if (!node.source && node.specifiers.length) context.report({ node, messageId: 'localExport' })
      }
    }
  }
}

const noIndexTsx = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        'No `index.tsx` — use `index.ts` for a barrel, a named component file, or `<segment>.index.tsx` for a route.'
    }
  },
  create(context) {
    if (!/[\\/]index\.tsx$/.test(filenameFor(context))) return {}
    return { Program: (node) => context.report({ node, messageId: 'forbidden' }) }
  }
}

const namedOnlyBarrel = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'A barrel exposes named exports; do not forward a bare default.' }
  },
  create(context) {
    if (!/[\\/]index\.tsx?$/.test(filenameFor(context))) return {}
    return {
      ExportNamedDeclaration(node) {
        if (!node.source) return
        for (const specifier of node.specifiers) {
          if (specifier.exported?.name === 'default') context.report({ node: specifier, messageId: 'forbidden' })
        }
      }
    }
  }
}

const barrelClosed = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Deep import into a closed barrel — import its index instead.' }
  },
  create(context) {
    const importer = filenameFor(context)
    const check = (node, specifier) => {
      const target = resolveBarrelImport(specifier, importer)
      if (!target) return
      const crossed = outermostCrossedBarrelDir(target, importer)
      if (!crossed || target === path.join(crossed, 'index.ts')) return
      context.report({ node, messageId: 'forbidden' })
    }
    return importVisitors(check)
  }
}

const barrelNoNesting = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'A barrel must not re-export another barrel; let each unit own its entry point.' }
  },
  create(context) {
    const importer = filenameFor(context)
    if (!/[\\/]index\.ts$/.test(importer)) return {}
    const importerDirectory = path.dirname(importer)
    const check = (node, specifier) => {
      const target = resolveBarrelImport(specifier, importer)
      if (!target) return
      const targetBarrel = innermostBarrelDir(target)
      if (targetBarrel && targetBarrel !== importerDirectory) context.report({ node, messageId: 'forbidden' })
    }
    return importVisitors(check)
  }
}

const noBucketRootBarrel = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Bucket roots (types/utils/services) must not expose a barrel.' }
  },
  create(context) {
    if (
      !/[\\/]src[\\/](?:main|renderer|shared)[\\/](?:types|utils|services)[\\/]index\.tsx?$/.test(filenameFor(context))
    ) {
      return {}
    }
    return { Program: (node) => context.report({ node, messageId: 'forbidden' }) }
  }
}

const isKebabName = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const isCamelName = (value) => /^[a-z][a-zA-Z0-9]*$/.test(value)
const isPascalName = (value) => /^[A-Z][a-zA-Z0-9]*$/.test(value)
const isRouteToken = (value) => value.startsWith('$') || value.startsWith('_')
const isModuleFileStem = (value) => {
  const bare = value.replace(/^_+/, '')
  return isCamelName(bare) || isPascalName(bare)
}

const NAMING_EXEMPT_DIRS = new Set(['__tests__', '__mocks__', '__snapshots__'])
const NAMING_ZONES = [
  {
    prefix: 'packages/ui/',
    root: 2,
    label: 'packages/ui',
    directory: isKebabName,
    directoryExpectation: 'kebab-case',
    file: isKebabName,
    fileExpectation: 'kebab-case'
  },
  {
    prefix: 'src/renderer/routes/',
    root: 3,
    label: 'routes',
    directory: (value) => isKebabName(value) || isRouteToken(value),
    directoryExpectation: 'kebab-case',
    file: (value) => isKebabName(value) || isRouteToken(value),
    fileExpectation: 'kebab-case'
  },
  { prefix: 'src/renderer/assets/', unmanaged: true },
  {
    prefix: 'src/renderer/',
    root: 2,
    label: 'src/renderer',
    directory: (value) => isCamelName(value) || isPascalName(value),
    directoryExpectation: 'camelCase or PascalCase',
    file: isModuleFileStem,
    fileExpectation: 'camelCase or PascalCase'
  },
  ...['main', 'shared', 'preload'].map((processName) => ({
    prefix: `src/${processName}/`,
    root: 2,
    label: `src/${processName}`,
    directory: isCamelName,
    directoryExpectation: 'camelCase',
    file: isModuleFileStem,
    fileExpectation: 'camelCase or PascalCase'
  }))
]

const namingReportedDirectories = new Set()
const pathCase = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      directory: 'Directory segment `{{name}}` must be {{expectation}} under {{zone}}.',
      file: 'File stem `{{name}}` must be {{expectation}} under {{zone}}.'
    }
  },
  create(context) {
    const relative = repoRelative(filenameFor(context))
    const zone = NAMING_ZONES.find((candidate) => relative.startsWith(candidate.prefix))
    if (!zone || zone.unmanaged) return {}

    return {
      Program(node) {
        const parts = relative.split('/')
        const fileName = parts.at(-1)
        const directories = parts.slice(zone.root, -1)
        for (let index = 0; index < directories.length; index++) {
          const segment = directories[index]
          if (segment.startsWith('.') || NAMING_EXEMPT_DIRS.has(segment) || zone.directory(segment)) continue
          const directory = parts.slice(0, zone.root + index + 1).join('/')
          if (namingReportedDirectories.has(directory)) continue
          namingReportedDirectories.add(directory)
          context.report({
            node,
            messageId: 'directory',
            data: { name: segment, expectation: zone.directoryExpectation, zone: zone.label }
          })
        }

        if (/^index\.tsx?$/.test(fileName) || fileName.endsWith('.d.ts')) return
        const stem = fileName.split('.')[0]
        if (!stem || zone.file(stem)) return
        context.report({
          node,
          messageId: 'file',
          data: { name: stem, expectation: zone.fileExpectation, zone: zone.label }
        })
      }
    }
  }
}

const noAsFilepath = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      absolute: '`as AbsoluteFilePath` forges the brand. Build it with AbsoluteFilePathSchema.parse(value) instead.',
      canonical:
        '`as CanonicalFilePath` forges the canonical dedup key. Build it with canonicalizeFilePath(value) instead.'
    }
  },
  create(context) {
    const check = (node) => {
      const annotation = node.typeAnnotation
      if (annotation?.type !== 'TSTypeReference' || annotation.typeName?.type !== 'Identifier') return
      if (annotation.typeName.name === 'AbsoluteFilePath') context.report({ node, messageId: 'absolute' })
      if (annotation.typeName.name === 'CanonicalFilePath') context.report({ node, messageId: 'canonical' })
    }
    return { TSAsExpression: check, TSTypeAssertion: check }
  }
}

const noDirectQuit = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      restricted: 'Quit APIs and signals are owned by the Application lifecycle; do not use {{name}} directly.'
    }
  },
  create(context) {
    const appMethods = new Set(['quit', 'exit', 'relaunch'])
    const appEvents = new Set(['before-quit', 'will-quit', 'window-all-closed'])
    const processSignals = new Set(['SIGINT', 'SIGTERM'])
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return
        const property = callee.property.type === 'Identifier' ? callee.property.name : null
        if (!property) return

        if (callee.object.name === 'app' && appMethods.has(property)) {
          context.report({ node, messageId: 'restricted', data: { name: `app.${property}()` } })
          return
        }

        const firstArgument = node.arguments[0]
        if (firstArgument?.type !== 'Literal' || typeof firstArgument.value !== 'string') return
        if (callee.object.name === 'app' && ['on', 'once'].includes(property) && appEvents.has(firstArgument.value)) {
          context.report({ node, messageId: 'restricted', data: { name: `app.${property}('${firstArgument.value}')` } })
        }
        if (
          callee.object.name === 'process' &&
          ['on', 'once'].includes(property) &&
          processSignals.has(firstArgument.value)
        ) {
          context.report({
            node,
            messageId: 'restricted',
            data: { name: `process.${property}('${firstArgument.value}')` }
          })
        }
      }
    }
  }
}

const noTemplateInTranslation = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '⚠️ Avoid template literals in t() — they make rendering output unpredictable' }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        const isTranslation =
          (callee.type === 'Identifier' && callee.name === 't') ||
          (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 't')
        if (isTranslation && node.arguments[0]?.type === 'TemplateLiteral') {
          context.report({ node: node.arguments[0], messageId: 'forbidden' })
        }
      }
    }
  }
}

const validateSchemaKey = (key) => {
  const templatePattern = /\$\{([^}]*)\}/g
  for (const match of key.matchAll(templatePattern)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(match[1])) return 'invalidTemplate'
  }
  const normalized = key.replace(/\$\{[^}]+\}/g, 'x')
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(normalized) ? null : 'invalidKey'
}

const validSchemaKey = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      invalidKey: 'Schema key `{{key}}` must follow namespace.sub.key_name.',
      invalidTemplate: 'Template variables in `{{key}}` must be valid identifiers.'
    }
  },
  create(context) {
    const check = (node) => {
      if (node.key?.type !== 'Literal' || typeof node.key.value !== 'string') return
      if (node.type === 'Property') {
        const objectExpression = node.parent
        const call = objectExpression?.parent
        if (
          call?.type === 'CallExpression' &&
          call.callee?.type === 'MemberExpression' &&
          call.callee.object?.type === 'Identifier' &&
          call.callee.object.name === 'z'
        ) {
          return
        }
      }
      const messageId = validateSchemaKey(node.key.value)
      if (messageId) context.report({ node: node.key, messageId, data: { key: node.key.value } })
    }
    return { TSPropertySignature: check, Property: check }
  }
}

const preferZodNamespace = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: { namespace: 'Import Zod as a namespace (`import * as z from "zod"`).' }
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string' || (source !== 'zod' && !source.startsWith('zod/'))) return
        for (const specifier of node.specifiers) {
          const isDefault = specifier.type === 'ImportDefaultSpecifier'
          const isZodNamed =
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            ['z', 'core'].includes(specifier.imported.name)
          if (!isDefault && !isZodNamed) continue

          const report = {
            node: specifier,
            messageId: 'namespace'
          }
          if (node.specifiers.length === 1) {
            report.fix = (fixer) => {
              const namespaceSource =
                isZodNamed && specifier.imported.name === 'core' && source === 'zod/v4' ? 'zod/v4/core' : source
              const typePrefix = node.importKind === 'type' ? 'type ' : ''
              return fixer.replaceText(
                node,
                `import ${typePrefix}* as ${specifier.local.name} from '${namespaceSource}'`
              )
            }
          }
          context.report(report)
        }
      }
    }
  }
}

const noPropTypes = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'TypeScript React components must use TypeScript types, not runtime propTypes.' }
  },
  create(context) {
    const isPropTypesMember = (node) =>
      node?.type === 'MemberExpression' &&
      ((node.property.type === 'Identifier' && node.property.name === 'propTypes') ||
        (node.property.type === 'Literal' && node.property.value === 'propTypes'))
    return {
      AssignmentExpression(node) {
        if (isPropTypesMember(node.left)) context.report({ node, messageId: 'forbidden' })
      },
      PropertyDefinition(node) {
        if (
          (node.key.type === 'Identifier' && node.key.name === 'propTypes') ||
          (node.key.type === 'Literal' && node.key.value === 'propTypes')
        ) {
          context.report({ node, messageId: 'forbidden' })
        }
      }
    }
  }
}

const dynamicReactChildrenMap = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '`React.Children.map` should not be used.' }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MemberExpression' &&
          callee.object.object.type === 'Identifier' &&
          callee.object.object.name === 'React' &&
          callee.object.property.type === 'Identifier' &&
          callee.object.property.name === 'Children' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'map'
        ) {
          context.report({ node, messageId: 'forbidden' })
        }
      }
    }
  }
}

const dynamicReactCloneElement = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: '`React.cloneElement` should not be used.' }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'React' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'cloneElement'
        ) {
          context.report({ node, messageId: 'forbidden' })
        }
      }
    }
  }
}

export const rules = {
  'renderer-boundaries': rendererBoundaries,
  'page-boundaries': pageBoundaries,
  'no-export-star': noExportStar,
  'index-no-impl': indexNoImplementation,
  'no-index-tsx': noIndexTsx,
  'barrel-named-only': namedOnlyBarrel,
  'barrel-closed': barrelClosed,
  'barrel-no-nesting': barrelNoNesting,
  'no-bucket-root-barrel': noBucketRootBarrel,
  'path-case': pathCase,
  'no-as-filepath': noAsFilepath,
  'no-direct-quit': noDirectQuit,
  'no-template-in-t': noTemplateInTranslation,
  'valid-schema-key': validSchemaKey,
  'prefer-zod-namespace': preferZodNamespace,
  'no-prop-types': noPropTypes,
  'dynamic-react-children-map': dynamicReactChildrenMap,
  'dynamic-react-clone-element': dynamicReactCloneElement
}

export default {
  meta: { name: 'cherry', version: '1.0.0' },
  rules
}
