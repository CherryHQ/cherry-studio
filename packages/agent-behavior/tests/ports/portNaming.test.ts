import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PORTS = fileURLToPath(new URL('../../src/ports/', import.meta.url))
const files = readdirSync(PORTS)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ts.createSourceFile(name, readFileSync(join(PORTS, name), 'utf8'), ts.ScriptTarget.Latest, true))
const HARNESS_NOUNS = new Set(['hook', 'commit', 'session', 'task', 'extension', 'durable', 'pi'])
/** Ports the design assigns keys or waits to (design §6). */
const KEYS_AND_WAITS: Readonly<Record<string, readonly ('keys' | 'waits')[]>> = {
  Ledger: ['keys'],
  Turns: ['keys', 'waits'],
  Helpers: ['keys', 'waits'],
  Jobs: ['keys'],
  Waits: ['waits'],
  Memory: ['keys'],
  ToolGate: ['keys', 'waits'],
  Approvals: ['keys', 'waits'],
  Questions: ['keys', 'waits'],
  Verifier: ['keys', 'waits'],
  OutputStore: ['keys'],
  Summarizer: ['keys']
}

const segments = (name: string) =>
  name
    .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase())

function identifiers(): string[] {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodSignature(node) ||
        ts.isParameter(node)) &&
      ts.isIdentifier(node.name)
    )
      names.push(node.name.text)
    ts.forEachChild(node, visit)
  }
  for (const file of files) visit(file)
  return names
}

function portInterfaces(): ts.InterfaceDeclaration[] {
  const declared = new Map<string, ts.InterfaceDeclaration>()
  for (const file of files)
    for (const statement of file.statements)
      if (ts.isInterfaceDeclaration(statement)) declared.set(statement.name.text, statement)
  return ['HarnessPorts', 'HostPorts']
    .flatMap((group) => declared.get(group)?.members ?? [])
    .filter(ts.isPropertySignature)
    .map((member) =>
      member.type && ts.isTypeReferenceNode(member.type) && ts.isIdentifier(member.type.typeName)
        ? member.type.typeName.text
        : ''
    )
    .map((name) => declared.get(name))
    .filter((port): port is ts.InterfaceDeclaration => port !== undefined)
}

const tagTexts = (node: ts.Node, tag: string) =>
  ts
    .getJSDocTags(node)
    .filter((t) => t.tagName.text === tag)
    .map((t) => ts.getTextOfJSDocComment(t.comment)?.trim() ?? '')

describe('port naming and documentation', () => {
  // Catches a port, method or parameter named after one harness's primitive (a Durable task, a Pi session or hook,
  // a commit), which would leak that harness's model into core and orchestration.
  it('uses no harness noun in any identifier', () => {
    expect(identifiers().filter((name) => segments(name).some((s) => HARNESS_NOUNS.has(s)))).toEqual([])
  })

  // Catches a port added without saying how coding-agent, Durable and the fake implement it, or without the keys and
  // waits the design assigns it, which leaves an adapter author guessing.
  it('documents every port for each harness, with its keys and waits', () => {
    const ports = portInterfaces()
    // Catches a port the discovery skips (a member not typed by a plain reference), which would escape this check.
    expect(ports).toHaveLength(20)
    const gaps = ports.flatMap((port) => {
      const name = port.name.text
      const harnesses = tagTexts(port, 'harness').map((text) => text.split(/\s+/)[0])
      return [
        ...['coding-agent', 'durable', 'fake']
          .filter((harness) => harnesses.filter((h) => h === harness).length !== 1)
          .map((harness) => `${name}: @harness ${harness}`),
        ...(KEYS_AND_WAITS[name] ?? [])
          .filter((tag) => !tagTexts(port, tag).some((text) => text !== ''))
          .map((tag) => `${name}: @${tag}`)
      ]
    })
    expect(gaps).toEqual([])
  })
})
