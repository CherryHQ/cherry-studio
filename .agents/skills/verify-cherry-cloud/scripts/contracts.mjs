import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const baseline = 'b22aae1dd46d2cacae5c35dba95412a4420e42ab'
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
const previous = (file) => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })
const current = (file) => readFileSync(new URL(file, new URL('../../../../', import.meta.url)), 'utf8')
const print = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source)

for (const file of [
  'src/main/services/cherryCloud/contracts.ts',
  'src/main/services/cherryCloud/crypto.ts',
  'src/main/services/cherryCloud/CherryCloudLoopbackCallback.ts',
  'src/main/services/cherryCloud/CherryAccountCredentialStore.ts'
]) {
  const before = parse(file, previous(file))
  const after = parse(file, current(file))
  assert.equal(print(after, after), print(before, before), `${file}: protected wire/security implementation changed`)
}

const schemaFile = 'src/shared/ipc/schemas/cherryCloud.ts'
const preserved = [
  'cherryCloudModelFeatureSchema',
  'cherryCloudModelSyncResultSchema',
  'cherryCloudSubscriptionPriceSchema',
  'cherryCloudPlanModelSchema',
  'cherryCloudPlanSummarySchema',
  'cherryCloudPublicPlanCatalogSchema',
  'cherryCloudQuotaWindowSchema',
  'cherryCloudQuotaPoolSchema',
  'cherryCloudPlanEntitlementSchema',
  'cherryCloudAccountPlansSchema',
  'subscriptionEntrySourceSchema',
  'quotaModelTypeSchema',
  'subscriptionFlowIdSchema',
  'cherryCloudAnalyticsEventSchema'
]
function definitions(source) {
  const result = new Map()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) result.set(declaration.name.text, print(declaration, source))
    }
  }
  return result
}
const beforeSchemas = definitions(parse(schemaFile, previous(schemaFile)))
const afterSchemas = definitions(parse(schemaFile, current(schemaFile)))
for (const name of preserved) {
  assert.ok(beforeSchemas.has(name), `missing baseline schema ${name}`)
  assert.equal(afterSchemas.get(name), beforeSchemas.get(name), `${name}: external contract changed`)
}

const serviceFile = 'src/main/services/cherryCloud/CherryCloudService.ts'
function requests(source) {
  const result = []
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'postJson' &&
      node.arguments[0]?.getText(source).includes('/api/v1/desktop/authorizations')
    ) {
      result.push(
        node.arguments
          .slice(0, 3)
          .map((arg) => print(arg, source))
          .join('\n')
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result.sort()
}
const oldRequests = requests(parse(serviceFile, previous(serviceFile)))
assert.equal(oldRequests.length, 2, 'baseline must contain creation and exchange requests')
assert.deepEqual(
  requests(parse(serviceFile, current(serviceFile))),
  oldRequests,
  'authorization paths/body/response contracts changed'
)
process.stdout.write(
  `Preserved ${preserved.length} external schemas, 4 security modules and 2 authorization request shapes at ${baseline.slice(0, 12)}.\n`
)

function methods(source) {
  const result = new Map()
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== 'CherryCloudService') continue
    for (const member of statement.members) {
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) result.set(member.name.text, member)
    }
  }
  return result
}
const oldService = parse(serviceFile, previous(serviceFile))
const newService = parse(serviceFile, current(serviceFile))
const oldMethods = methods(oldService)
const newMethods = methods(newService)
for (const name of [
  'authenticatedFetch',
  'activeSession',
  'refreshSession',
  'signedFetch',
  'postJson',
  'resolveRequestUrl',
  'recordQuotaRefusal',
  'persistSession'
]) {
  assert.ok(oldMethods.has(name) && newMethods.has(name), `missing security method ${name}`)
  assert.equal(
    print(newMethods.get(name), newService),
    print(oldMethods.get(name), oldService),
    `${name}: security/request implementation changed`
  )
}
const oldProjection = oldMethods.get('syncEntitledModelsOnce').body.statements
const projectionStart = oldProjection.findIndex((statement) =>
  statement.getText(oldService).startsWith('const activeEntitlements')
)
assert.notEqual(projectionStart, -1, 'missing baseline entitlement projection')
assert.deepEqual(
  newMethods.get('projectEntitledModels').body.statements.map((statement) => print(statement, newService)),
  oldProjection.slice(projectionStart).map((statement) => print(statement, oldService)),
  'entitlement/quota/model projection changed while moving to its owner'
)
process.stdout.write('Preserved 8 request/security methods and the complete entitlement/quota/model projection.\n')
