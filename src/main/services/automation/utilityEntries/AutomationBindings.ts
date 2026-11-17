import { parse, type Pattern } from 'acorn'
import { JSException, type QuickJS } from 'quickjs-wasi'

import type { AutomationBinding } from '../contracts'

type LexicalKind = 'let' | 'const' | 'class'

function bindingNames(pattern: Pattern): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name]
    case 'RestElement':
      return bindingNames(pattern.argument)
    case 'AssignmentPattern':
      return bindingNames(pattern.left)
    case 'ArrayPattern':
      return pattern.elements.flatMap((element) => (element ? bindingNames(element) : []))
    case 'ObjectPattern':
      return pattern.properties.flatMap((property) =>
        bindingNames(property.type === 'RestElement' ? property.argument : property.value)
      )
    default:
      return []
  }
}

export class AutomationBindings {
  private readonly lexical = new Map<string, LexicalKind>()
  private readonly builtins: Set<string>

  constructor(vm: QuickJS) {
    this.builtins = new Set(vm.global.getOwnPropertyNames())
  }

  prepare(code: string, enteredName: string) {
    const program = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true })
    const declarations = new Map<string, LexicalKind>()
    let insertion = code.startsWith('#!') ? (code.includes('\n') ? code.indexOf('\n') + 1 : code.length) : 0
    for (const statement of program.body) {
      if (statement.type === 'ExpressionStatement' && 'directive' in statement) insertion = statement.end
      else break
    }
    for (const statement of program.body) {
      if (statement.type === 'VariableDeclaration' && (statement.kind === 'let' || statement.kind === 'const')) {
        for (const declaration of statement.declarations) {
          for (const name of bindingNames(declaration.id)) declarations.set(name, statement.kind)
        }
      } else if (statement.type === 'ClassDeclaration' && statement.id) declarations.set(statement.id.name, 'class')
    }
    return {
      code: `${code.slice(0, insertion)}\n;{let __replEntry = ${enteredName}();}${code.slice(insertion)}`,
      entered: () => {
        for (const [name, kind] of declarations) this.lexical.set(name, kind)
      }
    }
  }

  inspect(vm: QuickJS): { bindings: AutomationBinding[]; truncated: boolean } {
    const names = new Set([
      ...this.lexical.keys(),
      ...vm.global.getOwnPropertyNames().filter((name) => !this.builtins.has(name))
    ])
    const bindings: AutomationBinding[] = []
    let bytes = 0
    for (const name of names) {
      const kind = this.lexical.get(name)
      let binding: AutomationBinding
      if (kind) {
        binding = { name, kind, declared: true, readable: false, canAssign: false, canRedeclare: false }
        try {
          using value = vm.evalCode(name)
          binding = { ...binding, readable: true, canAssign: kind !== 'const', type: value.typeof }
        } catch (error) {
          if (!(error instanceof JSException)) throw error
          error.dispose()
        }
      } else {
        const descriptor = vm.global.getOwnPropertyDescriptor(name)
        if (!descriptor) continue
        try {
          binding = {
            name,
            kind: 'global',
            declared: true,
            readable: descriptor.value !== undefined,
            canAssign:
              descriptor.value !== undefined ? descriptor.writable === true : descriptor.set?.isUndefined === false,
            canRedeclare: true,
            ...(descriptor.value !== undefined ? { type: descriptor.value.typeof } : {})
          }
        } finally {
          descriptor.value?.dispose()
          descriptor.get?.dispose()
          descriptor.set?.dispose()
        }
      }
      bytes += JSON.stringify(binding).length
      if (bindings.length >= 100 || bytes > 12_000) return { bindings, truncated: true }
      bindings.push(binding)
    }
    return { bindings, truncated: false }
  }
}
