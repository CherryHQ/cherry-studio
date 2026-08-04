import type { ContextExpr, ContextReader, ContextValue } from '@shared/types/command'

type ContextLiteral = string | number | boolean
type ConstraintPolarity = 'truthy' | 'falsy'

interface KeyConstraint {
  polarity?: ConstraintPolarity
  equals?: ContextLiteral
  notEquals: ContextLiteral[]
}

type ConstraintTerm = Map<string, KeyConstraint>

const DNF_TERM_LIMIT = 64

type Token =
  | { type: 'identifier'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'operator'; value: '!' | '&&' | '||' | '==' | '!=' | '(' | ')' }
  | { type: 'eof' }

class ContextExprParseError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly position: number
  ) {
    super(`${message} at ${position} in "${source}"`)
    this.name = 'ContextExprParseError'
  }
}

const isIdentifierStart = (char: string): boolean => /[A-Za-z_]/.test(char)
const isIdentifierPart = (char: string): boolean => /[A-Za-z0-9_.:-]/.test(char)

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let index = 0

  const fail = (message: string): never => {
    throw new ContextExprParseError(message, source, index)
  }

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      index++
      continue
    }

    const two = source.slice(index, index + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ type: 'operator', value: two })
      index += 2
      continue
    }

    if (char === '!' || char === '(' || char === ')') {
      tokens.push({ type: 'operator', value: char })
      index++
      continue
    }

    if (char === "'" || char === '"') {
      const quote = char
      let value = ''
      let closed = false
      index++

      while (index < source.length) {
        const next = source[index]
        if (next === quote) {
          index++
          tokens.push({ type: 'string', value })
          closed = true
          break
        }

        if (next === '\\') {
          const escaped = source[index + 1]
          if (escaped == null) {
            fail('Unterminated string literal')
          }
          value += escaped
          index += 2
          continue
        }

        value += next
        index++
      }

      if (!closed) {
        fail('Unterminated string literal')
      }
      continue
    }

    if (/[0-9]/.test(char)) {
      const start = index
      while (index < source.length && /[0-9.]/.test(source[index])) {
        index++
      }
      const raw = source.slice(start, index)
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        fail(`Invalid number "${raw}"`)
      }
      tokens.push({ type: 'number', value })
      continue
    }

    if (isIdentifierStart(char)) {
      const start = index
      index++
      while (index < source.length && isIdentifierPart(source[index])) {
        index++
      }
      const value = source.slice(start, index)
      if (value === 'true' || value === 'false') {
        tokens.push({ type: 'boolean', value: value === 'true' })
      } else {
        tokens.push({ type: 'identifier', value })
      }
      continue
    }

    fail(`Unexpected token "${char}"`)
  }

  tokens.push({ type: 'eof' })
  return tokens
}

class Parser {
  private index = 0

  constructor(
    private readonly source: string,
    private readonly tokens: Token[]
  ) {}

  parse(): ContextExpr {
    const expr = this.parseOr()
    if (this.peek().type !== 'eof') {
      this.fail('Unexpected trailing token')
    }
    return expr
  }

  private parseOr(): ContextExpr {
    const exprs = [this.parseAnd()]
    while (this.matchOperator('||')) {
      exprs.push(this.parseAnd())
    }
    return exprs.length === 1 ? exprs[0] : { type: 'or', exprs }
  }

  private parseAnd(): ContextExpr {
    const exprs = [this.parseEquality()]
    while (this.matchOperator('&&')) {
      exprs.push(this.parseEquality())
    }
    return exprs.length === 1 ? exprs[0] : { type: 'and', exprs }
  }

  private parseEquality(): ContextExpr {
    const left = this.parseUnary()
    const operator = this.matchOperator('==') ? '==' : this.matchOperator('!=') ? '!=' : null
    if (!operator) {
      return left
    }

    if (left.type !== 'key') {
      this.fail('Left side of equality must be a context key')
    }

    const value = this.parseLiteral()
    return operator === '==' ? { type: 'equals', key: left.key, value } : { type: 'notEquals', key: left.key, value }
  }

  private parseUnary(): ContextExpr {
    if (this.matchOperator('!')) {
      return { type: 'not', expr: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ContextExpr {
    const token = this.peek()
    if (token.type === 'identifier') {
      this.index++
      return { type: 'key', key: token.value }
    }

    if (this.matchOperator('(')) {
      const expr = this.parseOr()
      this.expectOperator(')')
      return expr
    }

    this.fail('Expected context key or grouped expression')
  }

  private parseLiteral(): string | number | boolean {
    const token = this.peek()
    if (token.type === 'string' || token.type === 'number' || token.type === 'boolean') {
      this.index++
      return token.value
    }
    this.fail('Expected literal')
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private matchOperator(value: '!' | '&&' | '||' | '==' | '!=' | '(' | ')'): boolean {
    const token = this.peek()
    if (token.type === 'operator' && token.value === value) {
      this.index++
      return true
    }
    return false
  }

  private expectOperator(value: '!' | '&&' | '||' | '==' | '!=' | '(' | ')'): void {
    if (!this.matchOperator(value)) {
      this.fail(`Expected "${value}"`)
    }
  }

  private fail(message: string): never {
    throw new ContextExprParseError(message, this.source, this.index)
  }
}

export const parseContextExpr = (source: string): ContextExpr => {
  const trimmed = source.trim()
  if (!trimmed) {
    throw new ContextExprParseError('Empty context expression', source, 0)
  }
  return new Parser(trimmed, tokenize(trimmed)).parse()
}

const readContextValue = (context: ContextReader, key: string): ContextValue => {
  if (typeof context === 'function') {
    return context(key)
  }
  if (context instanceof Map) {
    return context.get(key)
  }
  return context[key]
}

export const evaluateContextExpr = (expr: ContextExpr | undefined, context: ContextReader): boolean => {
  if (!expr) {
    return true
  }

  switch (expr.type) {
    case 'key':
      return Boolean(readContextValue(context, expr.key))
    case 'not':
      return !evaluateContextExpr(expr.expr, context)
    case 'and':
      return expr.exprs.every((item) => evaluateContextExpr(item, context))
    case 'or':
      return expr.exprs.some((item) => evaluateContextExpr(item, context))
    case 'equals':
      return readContextValue(context, expr.key) === expr.value
    case 'notEquals':
      return readContextValue(context, expr.key) !== expr.value
  }
}

export const collectContextKeys = (expr: ContextExpr | undefined): string[] => {
  if (!expr) {
    return []
  }

  switch (expr.type) {
    case 'key':
    case 'equals':
    case 'notEquals':
      return [expr.key]
    case 'not':
      return collectContextKeys(expr.expr)
    case 'and':
    case 'or':
      return Array.from(new Set(expr.exprs.flatMap(collectContextKeys)))
  }
}

const createConstraint = (patch: Partial<KeyConstraint>): KeyConstraint => ({
  notEquals: [],
  ...patch
})

const cloneTerm = (term: ConstraintTerm): ConstraintTerm => {
  const next = new Map<string, KeyConstraint>()
  for (const [key, constraint] of term) {
    next.set(key, { ...constraint, notEquals: [...constraint.notEquals] })
  }
  return next
}

const valuesEqual = (left: ContextLiteral, right: ContextLiteral): boolean => left === right

const mergeConstraint = (left: KeyConstraint, right: KeyConstraint): KeyConstraint | undefined => {
  const next: KeyConstraint = {
    polarity: left.polarity,
    equals: left.equals,
    notEquals: [...left.notEquals]
  }

  if (right.polarity) {
    if (next.polarity && next.polarity !== right.polarity) {
      return undefined
    }
    next.polarity = right.polarity
  }

  if (right.equals !== undefined) {
    if (next.equals !== undefined && !valuesEqual(next.equals, right.equals)) {
      return undefined
    }
    if (next.notEquals.some((value) => valuesEqual(value, right.equals as ContextLiteral))) {
      return undefined
    }
    next.equals = right.equals
  }

  for (const value of right.notEquals) {
    if (next.equals !== undefined && valuesEqual(next.equals, value)) {
      return undefined
    }
    if (!next.notEquals.some((item) => valuesEqual(item, value))) {
      next.notEquals.push(value)
    }
  }

  if (next.equals !== undefined && next.polarity) {
    const isTruthy = Boolean(next.equals)
    if ((next.polarity === 'truthy' && !isTruthy) || (next.polarity === 'falsy' && isTruthy)) {
      return undefined
    }
  }

  return next
}

const mergeTerm = (left: ConstraintTerm, right: ConstraintTerm): ConstraintTerm | undefined => {
  const next = cloneTerm(left)

  for (const [key, rightConstraint] of right) {
    const leftConstraint = next.get(key)
    if (!leftConstraint) {
      next.set(key, { ...rightConstraint, notEquals: [...rightConstraint.notEquals] })
      continue
    }

    const merged = mergeConstraint(leftConstraint, rightConstraint)
    if (!merged) {
      return undefined
    }
    next.set(key, merged)
  }

  return next
}

const mergeDnfTerms = (
  left: ConstraintTerm[] | undefined,
  right: ConstraintTerm[] | undefined
): ConstraintTerm[] | undefined => {
  if (!left || !right) {
    return undefined
  }

  const result: ConstraintTerm[] = []
  for (const leftTerm of left) {
    for (const rightTerm of right) {
      if (result.length >= DNF_TERM_LIMIT) {
        return undefined
      }
      const merged = mergeTerm(leftTerm, rightTerm)
      if (merged) {
        result.push(merged)
      }
    }
  }

  return result
}

const concatDnfTerms = (
  left: ConstraintTerm[] | undefined,
  right: ConstraintTerm[] | undefined
): ConstraintTerm[] | undefined => {
  if (!left || !right) {
    return undefined
  }
  if (left.length + right.length > DNF_TERM_LIMIT) {
    return undefined
  }
  return [...left, ...right]
}

const singleConstraintTerm = (key: string, constraint: KeyConstraint): ConstraintTerm[] => [
  new Map([[key, constraint]])
]

const toDnfTerms = (expr: ContextExpr | undefined, negated = false): ConstraintTerm[] | undefined => {
  if (!expr) {
    return negated ? [] : [new Map()]
  }

  switch (expr.type) {
    case 'key':
      return singleConstraintTerm(expr.key, createConstraint({ polarity: negated ? 'falsy' : 'truthy' }))
    case 'equals':
      return singleConstraintTerm(
        expr.key,
        negated ? createConstraint({ notEquals: [expr.value] }) : createConstraint({ equals: expr.value })
      )
    case 'notEquals':
      return singleConstraintTerm(
        expr.key,
        negated ? createConstraint({ equals: expr.value }) : createConstraint({ notEquals: [expr.value] })
      )
    case 'not':
      return toDnfTerms(expr.expr, !negated)
    case 'and': {
      if (negated) {
        return expr.exprs.reduce<ConstraintTerm[] | undefined>(
          (acc, item) => concatDnfTerms(acc, toDnfTerms(item, true)),
          []
        )
      }
      return expr.exprs.reduce<ConstraintTerm[] | undefined>(
        (acc, item) => mergeDnfTerms(acc, toDnfTerms(item)),
        [new Map()]
      )
    }
    case 'or': {
      if (negated) {
        return expr.exprs.reduce<ConstraintTerm[] | undefined>(
          (acc, item) => mergeDnfTerms(acc, toDnfTerms(item, true)),
          [new Map()]
        )
      }
      return expr.exprs.reduce<ConstraintTerm[] | undefined>((acc, item) => concatDnfTerms(acc, toDnfTerms(item)), [])
    }
  }
}

/**
 * Returns false only when the two expressions are provably mutually exclusive.
 * Unknown or overly complex expressions conservatively return true.
 */
export const canContextExprsOverlap = (left: ContextExpr | undefined, right: ContextExpr | undefined): boolean => {
  const leftTerms = toDnfTerms(left)
  const rightTerms = toDnfTerms(right)

  if (!leftTerms || !rightTerms) {
    return true
  }
  if (leftTerms.length === 0 || rightTerms.length === 0) {
    return false
  }

  for (const leftTerm of leftTerms) {
    for (const rightTerm of rightTerms) {
      if (mergeTerm(leftTerm, rightTerm)) {
        return true
      }
    }
  }

  return false
}

export class ContextKeyService {
  private values = new Map<string, ContextValue>()

  get(key: string): ContextValue {
    return this.values.get(key)
  }

  set(key: string, value: ContextValue): void {
    if (value === undefined) {
      this.values.delete(key)
      return
    }
    this.values.set(key, value)
  }

  update(values: Record<string, ContextValue>): void {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value)
    }
  }

  evaluate(expr: ContextExpr | undefined): boolean {
    return evaluateContextExpr(expr, this.values)
  }

  snapshot(): ReadonlyMap<string, ContextValue> {
    return new Map(this.values)
  }
}
