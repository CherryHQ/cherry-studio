# Code Review Checklist

Review in priority order: A (highest impact) → B → C. The reviewer prompt specifies
which levels to check. Test code: only check for obvious implementation errors.

Project rules loaded in context override this checklist.

## React & Performance Deep Reference

For React component and performance reviews, also consult
`vercel-react-best-practices` skill (`../../vercel-react-best-practices/SKILL.md`).
It provides 62 detailed rules covering re-render optimization, bundle size,
async patterns, rendering performance, and advanced React patterns. The checklist
items below (B1, B8, A5, A6) are high-level checks — the Vercel rules provide
specific patterns and code examples for deeper analysis.

---

## A. Correctness & Safety

Issues that directly affect runtime behavior.

### A1. Code Correctness
- Return values / out-parameters set correctly in all branches (including error paths)
- Implementation matches behavior described by function name / comments
- Conditional logic free of && / || mix-ups, missing negation, precedence errors
- switch/case covers all branches with no unintended fall-through

### A2. Boundary Conditions
> For internal (non-public-API) functions: if callers provably guarantee a
> precondition (e.g., non-null, non-empty, within range), the guard is
> unnecessary — do not flag. Verify the guarantee by reading actual callers.
- Division-by-zero protected (both float and integer)
- Empty container checked before indexing (array[0], .at(0), etc.)
- Null / undefined dereference guarded (especially optional chaining gaps)
- Integer overflow / underflow handled (especially unsigned subtraction)
- Array / string bounds checked

### A3. Error Handling
- I/O operation results checked for errors
- Parse results validated before use (JSON.parse, parseInt, etc.)
- External input validated for legality
- Failed calls have reasonable fallback / safe return
- Promises / async calls properly awaited with error handling (try/catch or .catch)
- IPC calls validated in main process handlers

### A4. Injection & Sensitive Data
- User input sanitized before DOM insertion (innerHTML, dangerouslySetInnerHTML,
  v-html, document.write, etc.)
- URL parameters, localStorage, postMessage data validated before use
- No hard-coded API keys, tokens, or credentials in client-side code
- Node.js APIs not exposed directly to renderer; use contextBridge in preload
- SQL inputs parameterized (Drizzle ORM prepared statements)

### A5. Resource Management
- Event listeners, timers, subscriptions, observers cleaned up on unmount / scope
  exit (useEffect cleanup)
- File handles / system resources properly closed
- Database connections / network sockets released in finally blocks
- AbortController used and cleaned up for cancellable async operations
- IPC listeners removed when no longer needed

### A6. Memory Safety
- No stale closure captures in useEffect / useCallback / useMemo
- No dangling references to unmounted component state (setState after unmount)
- WeakRef / WeakMap used where appropriate to avoid memory leaks
- Large objects not inadvertently retained in closures

### A7. Thread Safety & Concurrency
> Only flag when the access pattern is clearly unsafe.
- Shared mutable state in main process accessed safely across IPC handlers
- Race conditions in async operations (concurrent state mutations)
- Web Worker message handling with proper serialization
- Electron main/renderer process boundary respected

---

## B. Refactoring & Optimization

Improvements to code quality, performance, and maintainability.

### B1. Performance
- Container space pre-allocated when size is predictable
- No unnecessary deep copies (only flag when semantic equivalence is certain)
- Loop-invariant expressions hoisted outside loops
- Frequent string concatenation inside loops optimized
- No unnecessary temporary object construction
- No unnecessary re-renders from missing memoization, unstable references, or inline
  object/function creation in props (React.memo, useMemo, useCallback)
- No full imports of large dependencies when only a small part is used (tree-shaking)
- Redux selectors properly memoized to avoid unnecessary re-renders

### B2. Code Simplification
- Clearly duplicated or similar logic extracted (judge by complexity and maintenance
  cost, not count threshold)
- Deep nested if/else simplified with early return
- Redundant conditional checks merged or eliminated
- Overly long functions split into single-responsibility sub-methods

### B3. Module Architecture
> Only flag when the diff introduces a new dependency or moves code across module
> boundaries.
- Module responsibilities clear with no boundary violations
- Dependency direction reasonable (main ← shared → renderer, not renderer → main)
- No circular dependencies
- IPC channel constants defined in packages/shared/IpcChannel.ts

### B4. Interface Usage
- Called APIs used according to their design intent and documentation
- No use of deprecated interfaces
- Vercel AI SDK v5 patterns followed correctly

### B5. Interface Changes
> Flag only — describe the change and its scope for the coordinator to assess.
- Public API signature or class interface changes identified and described
- IPC channel contract changes identified

### B6. Test Coverage
> Flag only — report for awareness, do not auto-fix.
- Changed logic paths have corresponding test cases
- Boundary conditions have test coverage
- Error paths have test coverage

### B7. Regression Risk
> Flag only — report for awareness, do not auto-fix.
- Modification impact on other callers assessed
- Behavior changes consistent across all target platforms (macOS, Windows, Linux)

### B8. Rendering Correctness
- List items rendered with stable, unique key (not array index)
- Side effects correctly placed in useEffect with proper dependency arrays
- Component state derived correctly (no stale closures, no out-of-sync derived state)
- Redux state shape not modified (v2 refactoring block)
- Dexie (IndexedDB) schema not modified (v2 refactoring block)

---

## C. Conventions & Documentation

Coding standards and documentation consistency.

### C1. Project Conventions
- Naming follows project's existing style (PascalCase for components, camelCase for
  services/hooks/utils)
- Variable names semantically clear, no unnecessary abbreviations
- Names in new code consistent with style in the same file
- Logging uses `loggerService` with proper context — no `console.log`
- All user-visible strings use i18next — no hardcoded UI strings

### C2. File Organization
- React components in PascalCase.tsx, services/hooks/utils in camelCase.ts
- Test files as *.test.ts or *.spec.ts alongside source or in __tests__/
- Import order follows simple-import-sort conventions

### C3. Type Safety
- No implicit narrowing conversions
- No `any` types where a proper type exists
- Magic numbers extracted as named constants (unless context already makes meaning
  clear)
- TypeScript strict mode respected

### C4. Const Correctness
- Unmodified variables declared with const
- Objects/arrays that should not be reassigned use const
- Readonly types used for function parameters where appropriate

### C5. Documentation Consistency
- Type names in code consistent with project documentation
- Value ranges in comments consistent with implementation

### C6. Public API Comments
- Public API comments accurately describe current behavior, parameters, return values
- Comments updated when corresponding API behavior changes
- JSDoc present on exported functions/classes where non-obvious

### C7. Accessibility
- Images have meaningful alt text (empty alt for decorative images)
- Form inputs have associated labels (Ant Design Form.Item)
- Interactive elements keyboard-navigable with semantic HTML
- ARIA attributes used correctly with Ant Design components

---

## Exclusion List

> Project rules override this exclusion list. If project rules have explicit requirements
> for an excluded issue type, that type is **not excluded** — review per project rules.

1. Pure style preferences within formatting tool scope (not required by project rules)
2. Formatting already handled by Biome (indentation, whitespace, trailing commas, etc.)
3. Suggestions based on assumed future requirements, not current code
4. Code following project's existing style but not matching some external standard
5. Priority C issues in test code (unless project rules require otherwise)
6. "Better alternative" suggestions for existing stable, bug-free code
7. Missing guards in internal functions when callers provably guarantee the precondition
   (only applies to non-public-API code; verify by reading actual call sites)
