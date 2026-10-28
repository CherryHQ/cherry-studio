import ts from 'typescript'

/** Collect literal translation keys without interpreting comments, strings or regexes as calls. */
export function collectMainTranslationKeys(content: string, filename: string): { keys: string[]; dynamic: string[] } {
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@main/i18n'
    )
      continue
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    if (clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 't') names.add(binding.name.text)
    }
  }
  const keys: string[] = []
  const dynamic: string[] = []
  if (!names.size) return { keys, dynamic }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
      const key = node.arguments[0]
      if (key && ts.isStringLiteral(key)) keys.push(key.text)
      else dynamic.push(node.getText(source).slice(0, 80).split('\n')[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { keys, dynamic }
}
