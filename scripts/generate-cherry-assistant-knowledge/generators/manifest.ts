import * as fs from 'node:fs'
import * as path from 'node:path'

import { Node, type ObjectLiteralExpression, Project, SyntaxKind } from 'ts-morph'

import { appLanguageOptions } from '../../../src/renderer/i18n/languages'
import { CodeCli } from '../../../src/shared/types/codeCli'
import { COMMAND_DEFINITIONS } from '../../../src/shared/utils/command/definitions'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const PACKAGE_JSON_FILE = path.join(ROOT_DIR, 'package.json')
const ROUTE_TREE_FILE = path.join(ROOT_DIR, 'src/renderer/routeTree.gen.ts')
const SIDEBAR_FILE = path.join(ROOT_DIR, 'src/renderer/utils/sidebar.ts')
const PROVIDERS_FILE = path.join(ROOT_DIR, 'packages/provider-registry/data/providers.json')
const AGENT_CHANNELS_FILE = path.join(ROOT_DIR, 'src/shared/data/api/schemas/agentChannels.ts')
const JOBS_FILE = path.join(ROOT_DIR, 'src/shared/data/api/schemas/jobs.ts')

interface PackageJson {
  name: string
  version: string
  description: string
  homepage: string
}

interface ProviderRegistryFile {
  version: string
  providers: Array<{ id: string; name: string } & Record<string, unknown>>
}

export interface ProductManifest {
  schemaVersion: 1
  package: Pick<PackageJson, 'name' | 'version' | 'description' | 'homepage'>
  routes: {
    primary: Array<{ id: string; path: string }>
    all: string[]
  }
  commands: Array<{
    id: string
    titleKey: string
    categoryKey: string
    scope: string
    enablement?: string
    keybinding?: {
      defaultBinding: string[]
      additionalBindings?: string[][]
      editable?: boolean
      global?: boolean
      when?: string
      supportedPlatforms?: string[]
    }
  }>
  providers: {
    version: string
    count: number
    entries: Array<{ id: string; name: string }>
  }
  locales: Array<{ value: string; label: string; flag: string }>
  agents: {
    channelTypes: string[]
    scheduleTriggerKinds: string[]
    codeCli: {
      route: string
      tools: string[]
    }
  }
}

function readPackageMetadata(): ProductManifest['package'] {
  const { name, version, description, homepage } = JSON.parse(
    fs.readFileSync(PACKAGE_JSON_FILE, 'utf-8')
  ) as PackageJson
  return { name, version, description, homepage }
}

function readProviders(): ProductManifest['providers'] {
  const { version, providers } = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf-8')) as ProviderRegistryFile
  return {
    version,
    count: providers.length,
    entries: providers.map(({ id, name }) => ({ id, name }))
  }
}

function readAllRoutes(): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(ROUTE_TREE_FILE)
  const routeInterface = sourceFile.getInterfaceOrThrow('FileRoutesByFullPath')

  return [
    ...new Set(
      routeInterface.getProperties().map((property) => {
        const name = property.getNameNode()
        if (!Node.isStringLiteral(name)) {
          throw new Error(`FileRoutesByFullPath contains a non-literal route: ${property.getText()}`)
        }
        const route = name.getLiteralValue()
        return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route
      })
    )
  ]
}

function readStringProperty(object: ObjectLiteralExpression, propertyName: string): string {
  const property = object.getPropertyOrThrow(propertyName)
  if (!Node.isPropertyAssignment(property)) {
    throw new Error(`${propertyName} must be a property assignment in SIDEBAR_APP_DEFINITIONS`)
  }
  const value = property.getInitializerOrThrow()
  if (!Node.isStringLiteral(value)) {
    throw new Error(`${propertyName} must be a string literal in SIDEBAR_APP_DEFINITIONS`)
  }
  return value.getLiteralValue()
}

function readPrimaryRoutes(): ProductManifest['routes']['primary'] {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(SIDEBAR_FILE)
  const publicInitializer = sourceFile.getVariableDeclarationOrThrow('SIDEBAR_APPS').getInitializerOrThrow()
  if (!Node.isIdentifier(publicInitializer)) {
    throw new Error('SIDEBAR_APPS must reference the sidebar definition array')
  }
  const initializer = sourceFile.getVariableDeclarationOrThrow(publicInitializer.getText()).getInitializerOrThrow()
  const definitions = initializer.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression)

  return definitions.getElements().map((element) => {
    if (!Node.isObjectLiteralExpression(element)) {
      throw new Error(`SIDEBAR_APP_DEFINITIONS contains a non-object entry: ${element.getText()}`)
    }
    return {
      id: readStringProperty(element, 'id'),
      path: readStringProperty(element, 'routePrefix')
    }
  })
}

function readChannelTypes(): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(AGENT_CHANNELS_FILE)
  const initializer = sourceFile.getVariableDeclarationOrThrow('AgentChannelTypeSchema').getInitializerOrThrow()
  const values = initializer.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression)

  return values.getElements().map((element) => {
    if (!Node.isStringLiteral(element)) {
      throw new Error(`AgentChannelTypeSchema contains a non-literal value: ${element.getText()}`)
    }
    return element.getLiteralValue()
  })
}

function readScheduleTriggerKinds(): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(JOBS_FILE)
  const triggerInitializer = sourceFile.getVariableDeclarationOrThrow('TriggerSchema').getInitializerOrThrow()
  const triggerSchemas = triggerInitializer.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression)

  return triggerSchemas.getElements().map((element) => {
    if (!Node.isIdentifier(element)) {
      throw new Error(`TriggerSchema contains a non-identifier schema: ${element.getText()}`)
    }
    const schemaInitializer = sourceFile.getVariableDeclarationOrThrow(element.getText()).getInitializerOrThrow()
    const schemaShape = schemaInitializer.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression)
    const kindProperty = schemaShape.getPropertyOrThrow('kind')
    if (!Node.isPropertyAssignment(kindProperty)) {
      throw new Error(`${element.getText()}.kind must be a property assignment`)
    }
    const literalCall = kindProperty.getInitializerOrThrow()
    if (!Node.isCallExpression(literalCall)) {
      throw new Error(`${element.getText()}.kind must be a z.literal call`)
    }
    const value = literalCall.getArguments()[0]
    if (!Node.isStringLiteral(value)) {
      throw new Error(`${element.getText()}.kind must contain a string literal`)
    }
    return value.getLiteralValue()
  })
}

function readAgentCapabilities(primaryRoutes: ProductManifest['routes']['primary']): ProductManifest['agents'] {
  const codeCliRoute = primaryRoutes.find(({ id }) => id === 'code_tools')?.path
  if (!codeCliRoute) {
    throw new Error('SIDEBAR_APP_DEFINITIONS does not contain the code_tools route')
  }

  return {
    channelTypes: readChannelTypes(),
    scheduleTriggerKinds: readScheduleTriggerKinds(),
    codeCli: {
      route: codeCliRoute,
      tools: Object.values(CodeCli)
    }
  }
}

export function generateProductManifest(): ProductManifest {
  const primaryRoutes = readPrimaryRoutes()
  return {
    schemaVersion: 1,
    package: readPackageMetadata(),
    routes: {
      primary: primaryRoutes,
      all: readAllRoutes()
    },
    commands: JSON.parse(JSON.stringify(COMMAND_DEFINITIONS)) as ProductManifest['commands'],
    providers: readProviders(),
    locales: [...appLanguageOptions],
    agents: readAgentCapabilities(primaryRoutes)
  }
}

export function serializeProductManifest(manifest: ProductManifest = generateProductManifest()): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
