import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import ts from 'typescript'

const methods = [
  'initialize',
  'model/list',
  'skills/list',
  'config/read',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'thread/name/set',
  'thread/compact/start',
  'thread/revert',
  'thread/turns/list',
  'thread/goal/get',
  'thread/goal/set',
  'thread/goal/clear',
  'collaborationMode/list',
  'experimentalFeature/list',
  'turn/steer',
  'turn/start',
  'turn/interrupt',
  'review/start',
  'account/usage/read',
  'account/read',
  'account/rateLimits/read',
  'gitDiffToRemote',
  'command/exec',
  'mcpServerStatus/list'
]
const dir = mkdtempSync(join(tmpdir(), 'cherry-codex-schema-'))
try {
  const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim()
  execFileSync('codex', ['app-server', 'generate-ts', '--experimental', '--out', dir])
  const parse = (file) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const printer = ts.createPrinter({ removeComments: true })
  const declarations = new Map()
  const seen = new Set()
  function include(file) {
    if (seen.has(file)) return
    seen.add(file)
    const source = parse(file)
    for (const node of source.statements) {
      if (ts.isImportDeclaration(node)) include(resolve(dirname(file), node.moduleSpecifier.text + '.ts'))
      else if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text
        if (declarations.has(name)) throw new Error('Ambiguous protocol type ' + name)
        declarations.set(
          name,
          printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\bnull(?: \| null)+\b/g, 'null')
        )
      }
    }
  }
  const requests = parse(join(dir, 'ClientRequest.ts'))
  const union = requests.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'ClientRequest'
  )
  const imports = new Map(
    requests.statements
      .filter(ts.isImportDeclaration)
      .flatMap((node) =>
        node.importClause.namedBindings.elements.map((item) => [item.name.text, node.moduleSpecifier.text])
      )
  )
  const entries = methods.map((method) => {
    const variant = union.type.types.find((variant) =>
      variant.members.some((field) => field.name.text === 'method' && field.type.literal.text === method)
    )
    if (!variant) throw new Error('Missing Codex method ' + method)
    const params = variant.members.find((field) => field.name.text === 'params')
    const type = ts.isUnionTypeNode(params.type) ? params.type.types.find(ts.isTypeReferenceNode) : params.type
    const name = type.typeName.text
    include(resolve(dir, imports.get(name) + '.ts'))
    return '  ' + JSON.stringify(method) + ': ' + name
  })
  const serverResponses = {
    'item/commandExecution/requestApproval': 'CommandExecutionRequestApprovalResponse',
    'item/fileChange/requestApproval': 'FileChangeRequestApprovalResponse',
    'item/permissions/requestApproval': 'PermissionsRequestApprovalResponse',
    'item/tool/requestUserInput': 'ToolRequestUserInputResponse',
    'mcpServer/elicitation/request': 'McpServerElicitationRequestResponse'
  }
  for (const response of Object.values(serverResponses)) include(join(dir, 'v2', response + '.ts'))
  const header = '// Generated from ' + version + ' with scripts/generate-protocol.mjs.\n'
  const result =
    header +
    [...declarations.values()].join('\n\n') +
    '\n\nexport interface CodexRequestParams {\n' +
    entries.join('\n') +
    '\n}\n\nexport interface CodexServerReplies {\n' +
    Object.entries(serverResponses)
      .map(([method, type]) => '  ' + JSON.stringify(method) + ': ' + type)
      .join('\n') +
    '\n}\n'
  writeFileSync(new URL('../src/protocol.ts', import.meta.url), result)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
