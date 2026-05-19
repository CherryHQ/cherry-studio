## Guiding Principles (MUST FOLLOW)

### Mindset

How to approach any coding task in this repo.

#### Think Before Coding

- State assumptions explicitly. If uncertain, ask before implementing.
- When multiple interpretations exist, surface them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what is confusing. Ask.

#### Simplicity First

- Write the minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you wrote 200 lines and it could be 50, rewrite it.

#### Surgical Changes

- Touch only what the task requires. Do not "improve" adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style even if you would do it differently.
- If you notice unrelated dead code, mention it — do not delete it.
- Remove imports / variables / functions that **your** changes orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace directly to the user's request.

#### Goal-Driven Execution

- Convert tasks into verifiable goals before coding:
  - "Add validation" → "Write tests for invalid inputs, then make them pass."
  - "Fix the bug" → "Write a test that reproduces it, then make it pass."
  - "Refactor X" → "Ensure tests pass before and after."
- For multi-step tasks, state a brief plan with explicit verification per step:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

### Operational Rules

Project-specific tools, paths, and conventions.

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Read local READMEs first**: Before editing code in a directory, check for a `README.md` in that directory (and its parents) and read it — these files capture local conventions, invariants, and entry points that aren't obvious from the code alone.
- **Fix upstream, don't hack downstream**: When a new feature hits an existing module's limitation, flag the upstream improvement for the user's decision before proposing a downstream workaround.
- **Library-first, custom-last**: Before writing custom code, check library/framework docs for built-in options or existing solutions. Write custom code only when no adequate alternative exists.
- **Research via subagent**: Lean on `subagent` for external docs, APIs, news, and references.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@cherrystudio/ui` (located in `packages/ui`, Shadcn UI + Tailwind CSS) for every new UI component; never add `antd`, `HeroUI`, or `styled-components`.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Access paths centrally**: Use `application.getPath('namespace.key', filename?)` for all main-process filesystem paths—never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc. Import the singleton via `import { application } from '@application'`.
- **Lint, test, and format before completion**: Coding tasks are only complete after running `pnpm lint`, `pnpm test`, and `pnpm format` successfully.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat(data-api):`, `fix(lifecycle):`, `refactor(quick-assistant):`, `docs(testing):`, `chore(deps):`, `test(window-manager):`). Scope must be a specific kebab-case module, never generic like `main` — when `git log` conflicts with this rule, this rule wins.
- **Keep history linear**: On shared branches, never use plain `git pull` — it creates merge commits. Always `git pull --rebase` (or `git fetch && git rebase origin/<branch>`). Before `git push`, run `git fetch`; if `origin/<branch>` has advanced, rebase your local commits onto it first. If you notice a merge commit in local history that hasn't been pushed yet, rebase it away — cleaning one up after it's public requires a risky force-push on a shared branch.
- **Sign commits**: Use `git commit --signoff` as required by contributor guidelines.

## Development

### Commands

Run `pnpm install` first (requires Node ≥22, pnpm 10.27.0). For every other script, read `package.json` — the ones you must know:

- `pnpm lint` — oxlint + eslint fix + typecheck + i18n check + format check
- `pnpm test` — run all Vitest tests
- `pnpm format` — Biome format + lint (write mode)
- `pnpm build:check` — **REQUIRED before commits** (`pnpm lint && pnpm test`). If it fails on i18n sort, run `pnpm i18n:sync` first; on formatting, run `pnpm format` first.

### Testing

- Tests run with Vitest 3 (see `vitest.config.*` for project setup).
- **Features without tests are not considered complete**
- **Test Mocking**: Use the unified mock system — do NOT create ad-hoc mocks for `application`, services, or data layers. See [tests/__mocks__/README.md](tests/__mocks__/README.md) for available mocks, usage patterns, and best practices.
- **Database Tests**: For any service/handler/seeder that reads or writes SQLite, use `setupTestDatabase()` from `@test-helpers/db` — it provides a real file-backed DB with production migrations. Do NOT hand-write `CREATE TABLE` SQL, override `@application`, or stub Drizzle chains. See [docs/references/testing/database-testing.md](docs/references/testing/database-testing.md).

### Patched Dependencies

Before upgrading any dependency, check `patches/` for custom patches.

## GitHub

### Pull Requests

Use the `gh-create-pr` skill. Fallback: read `.agents/skills/gh-create-pr/SKILL.md` directly.

### Code Review

Do NOT run `pnpm lint` / `pnpm test` / `pnpm format` locally — inspect CI via `gh` instead.

### Issues

Use the `gh-create-issue` skill. Fallback: read `.agents/skills/gh-create-issue/SKILL.md` directly.

## Conventions

### TypeScript

- Place shared type definitions in `src/renderer/src/types/` or `packages/shared/`.

### File Naming

- React components: `PascalCase.tsx`
- Services, hooks, utilities: `camelCase.ts`
- Test files: `*.test.ts` or `*.spec.ts` alongside source or in `__tests__/` subdirectory

### Logging

```typescript
import { loggerService } from "@logger";
const logger = loggerService.withContext("moduleName");
// Renderer only: loggerService.initWindowSource('windowName') first
logger.info("message", CONTEXT);
logger.warn("message");
logger.error("message", error);
```

- Never use `console.log` — always use `loggerService`

### Paths

**MUST READ**: [src/main/core/paths/README.md](src/main/core/paths/README.md) — namespaces, naming, adding new keys, testing patterns. (Rule stated in Guiding Principle "Access paths centrally".)

### i18n

- All user-visible strings must use `i18next` — never hardcode UI strings
- Run `pnpm i18n:check` to validate; `pnpm i18n:sync` to add missing keys
- Locale files in `src/renderer/src/i18n/`

### UI Design

For any UI component or page style work, read [DESIGN.md](./DESIGN.md) first and follow its colors, fonts, spacing, and component specs strictly.

## Architecture

### Data

**MUST READ**: [docs/references/data/README.md](docs/references/data/README.md) for system selection, architecture, and patterns.

| System                                                     | Use Case                            | APIs                                                       |
| ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| [BootConfig](docs/references/data/boot-config-overview.md) | Early boot settings (pre-lifecycle) | `bootConfigService.get()`, `usePreference('BootConfig.*')` |
| [Cache](docs/references/data/cache-overview.md)            | Temp data (can lose)                | `useCache`, `useSharedCache`, `usePersistCache`            |
| [Preference](docs/references/data/preference-overview.md)  | User settings                       | `usePreference`                                            |
| [DataApi](docs/references/data/data-api-overview.md)       | Business data (**critical**)        | `useQuery`, `useMutation`                                  |

Scope:

- **BootConfig**: sync file-based; direct in main (pre-lifecycle), via `usePreference('BootConfig.*')` otherwise
- **Cache**: memory / shared (cross-window) / persist tiers; memory + shared on both main and renderer; persist is renderer-only (main relays IPC but doesn't store)
- **Preference**: cross-process (main + renderer); auto-syncs across windows
- **DataApi**: SQLite-backed; no auto-sync, fetch on demand from renderer

Database: SQLite + Drizzle ORM, schemas in `src/main/data/db/schemas/`, migrations via `pnpm db:migrations:generate`

**DataApi boundary rule**: DataApi is for SQLite-backed business data only. No database table → no DataApi endpoint; use IPC instead. See [Scope & Boundaries](docs/references/data/api-design-guidelines.md#dataapi-scope--boundaries).

### Window Manager

**MUST READ**: [docs/references/window-manager/README.md](docs/references/window-manager/README.md) — lifecycle modes, pool mechanics, API reference.

All `BrowserWindow` goes through `WindowManager` with one of three modes (`default` / `singleton` / `pooled`), declared per type in `src/main/core/window/windowRegistry.ts`.

- **Consumer API**: use only `open()` / `close()` — never `create()` / `destroy()` in business code.
- **Attach listeners in `onWindowCreated`**, not after `open()` — reused windows skip the latter.
- **Renderer reads init data via `useWindowInitData`**.

### Main Process Services (Lifecycle)

**MUST READ**: [docs/references/lifecycle/README.md](docs/references/lifecycle/README.md) — architecture, decision guides, usage patterns, and migration steps.

All main-process services that own long-lived resources or register persistent side effects **must** use the lifecycle system:

- **Extend `BaseService`**, apply `@Injectable`, `@ServicePhase`, `@DependsOn` decorators
- **Register in `serviceRegistry.ts`** (`src/main/core/application/serviceRegistry.ts`) — one line per service
- **Use `@DependsOn` for same-phase dependencies only** — do NOT declare dependencies on BeforeReady services (`PreferenceService`, `DbService`, `CacheService`, `DataApiService`) from WhenReady services; phase ordering is auto-enforced by the container
- **Access via `application.get('Name')`** (or `getOptional()` for `@Conditional` services)
- **Use `this.ipcHandle()` / `this.ipcOn()`** for IPC — auto-cleaned on stop/destroy, returns `Disposable`
- **Use `this.registerInterval()`** for recurring timers — auto-unref'd, exception-isolated, auto-cleaned on stop/destroy, returns `Disposable`
- **Use `this.registerDisposable()`** for cleanup tracking — accepts `Disposable` objects or `() => void` cleanup functions
- **Use `Emitter<T>` / `Event<T>`** for inter-service events, **`Signal<T>`** for one-shot completion
- **Implement `Activatable`** for services with heavy on-demand resources (IPC stays registered, resources load/release via `onActivate()`/`onDeactivate()`)
- **Do NOT** use `new` or manual singleton patterns — the container manages instantiation, ordering, and shutdown

For detailed code examples, see [Usage Guide](docs/references/lifecycle/lifecycle-usage.md). For migrating legacy services, see [Migration Guide](docs/references/lifecycle/lifecycle-migration-guide.md).

### Non-Lifecycle Services (Direct-Import Singleton)

Services without long-lived resources or persistent side effects: use **named export singleton** (`export const x = new X()`). No `getInstance()` patterns. See [Decision Guide](docs/references/lifecycle/lifecycle-decision-guide.md) for criteria.

## v2 Refactoring (In Progress)

### Data Layer

- **Removing**: Redux, Dexie, ElectronStore
- **Adopting**: Cache / Preference / DataApi architecture (see [Data](#data))

### UI Layer

- **Prohibited**: antd, HeroUI, styled-components
- **Adopting**: `@cherrystudio/ui` (located in `packages/ui`, Tailwind CSS + Shadcn UI)

### Coexistence Mindset

Two things on this branch are throwaway — do not defend them.

**v1 is throwaway.** "v1" here means the legacy data stacks listed in Data Layer above (Redux, Dexie, ElectronStore) and any call site that reads or writes through them. All such code will be deleted; v1 data reaches v2 only through the migrators in `src/main/data/migration/v2/`. So: no fallbacks, dual-writes, or guards for v1 save / read / loss; no fixing v1 bugs encountered during v2 work; leave mixed-branch v1 code alone unless it blocks v2.

**Schemas and drizzle SQL are throwaway.** `src/main/data/db/schemas/` may change freely; `migrations/sqlite-drizzle/*.sql` are dev-only artifacts overwritten by `drizzle-kit generate` on every schema change. Mid-development DB drift is acceptable — do not author patch migrations to "fix" it. `migrations/sqlite-drizzle/` will be wiped and regenerated from the final schemas as a single clean initial migration before release; only that regenerated migration must be correct.

### Data Classification Toolchain

The `v2-refactor-temp/tools/data-classify/` directory is the code generation pipeline for the v2 data layer. `classification.json` is the single source of truth.

The following four files are **auto-generated — NEVER edit them by hand**:

- `packages/shared/data/preference/preferenceSchemas.ts`
- `packages/shared/data/bootConfig/bootConfigSchemas.ts`
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`
- `src/main/data/migration/v2/migrators/mappings/BootConfigMappings.ts`

To change any of them, edit `classification.json` or `target-key-definitions.json`, then regenerate:

```bash
cd v2-refactor-temp/tools/data-classify && npm run generate
```

### Breaking Changes Log

When a v2 change is user-perceivable and affects how users use the app, add an entry under `v2-refactor-temp/docs/breaking-changes/`. See [v2-refactor-temp/docs/breaking-changes/README.md](v2-refactor-temp/docs/breaking-changes/README.md) for conventions.

## Security

- Never expose Node.js APIs directly to renderer; use `contextBridge` in preload
- Validate all IPC inputs in main process handlers
- URL sanitization via `strict-url-sanitise`
- IP validation via `ipaddr.js` (API server)
- `express-validator` for API server request validation

# Project-Specific Workflow: Conversation Graph Product Research

你现在是我的软件开发助手 + Obsidian 文档维护助手。

这个项目是在 Cherry Studio v2 方向上做一个新的 AI 对话产品原型。  
我的目标是开发一个支持：

- 主线对话 Main Thread
- 展开分支对话 Branch Thread
- 对话时间线 Timeline
- 分支总结 Branch Summary
- 整轮对话总结 Conversation Summary
- 标签与搜索
- 项目化 Workspace 管理

的结构化 AI 对话工作台。

请记住：

- Cherry Studio 现有代码中，会话实体主要叫 `Topic`。
- 我未来产品概念中可以叫 `Conversation`。
- 不要混淆两者。
- v1 旧代码只作为风险边界，不作为新功能长期实现路径。
- 新功能优先考虑 v2 方向、DataApi、SQLite/Drizzle、`@cherrystudio/ui`。

---

## 1. 工作原则

你不只是写代码，还要帮我维护工程记录。

每次执行任务时，请同时关注：

1. 实际任务是否推进；
2. 是否留下清晰 Markdown 记录；
3. 其他工程师能否通过文档快速接手；
4. 是否避免把所有内容堆进一个巨大文档；
5. 是否用有意义的 `[[Wikilinks]]` 建立关联。

默认所有说明性文档用中文。

不要为了形式主义写文档。  
不要把每次搜索、每个小动作都机械记录。  
只记录对项目理解、开发、决策、调试、结果有意义的内容。

---

## 2. 文档目录

项目专属文档统一放在 `/Docs`。

注意：仓库原本已有小写 `/docs`，不要把我的项目记录写进去。

如果 `/Docs` 不存在，请创建一个简洁结构：

```text
/Docs
  /01_Project
    - 项目总览.md
    - 当前状态.md
    - Roadmap.md
    - 风险与限制.md

  /02_Architecture
    - 系统架构.md
    - 源码地图.md
    - 数据模型.md
    - 对话架构设计.md

  /03_Development
    - 会话日志.md
    - 当前任务.md
    - 下一步.md
    - 问题与Debug记录.md
    - Git操作记录.md

  /04_Features
    /ExpandBranchChat
      - 功能总览.md
      - 交互流程.md
      - 数据设计.md
      - 实现记录.md
      - 测试记录.md

  /05_Notes
    - 白话解释-聊天模块.md
    - 学习记录.md
    - 灵感与草稿.md
    
如果出现新的功能模块，请在 /Docs/04_Features/功能名/ 下创建独立文档。
不要把所有功能都写进一个总文档。
```

## 3. 文档维护方式

每轮任务不需要机械更新所有文档。
请根据任务类型选择合适文档。

如果是读代码 / 理解源码

通常更新：

[[源码地图]]
[[当前状态]]
[[会话日志]]
[[下一步]]
必要时更新 [[白话解释-聊天模块]]
如果是设计功能

通常更新：

该功能目录下的 功能总览.md
交互流程.md
数据设计.md
[[对话架构设计]]
[[当前任务]]
[[下一步]]
如果是写代码

通常更新：

该功能目录下的 实现记录.md
[[会话日志]]
[[问题与Debug记录]]，如果出现问题
测试记录.md，如果涉及测试
[[当前状态]]
[[下一步]]
如果是调试问题

通常更新：

[[问题与Debug记录]]
对应功能的 实现记录.md
[[会话日志]]
[[下一步]]

原则：

一个文档只负责一个主题；
内容变长时拆分新文档；
用 [[Wikilinks]] 连接相关文档；
不要跨文档复制大段重复内容；
不确定内容必须标记为 待确认；
重要结论必须能追溯到源码、命令、测试或用户需求。

## 4. 每次任务的执行流程

每次我给你任务后，请按这个节奏工作：

先用简短语言复述任务目标；
判断这是：源码阅读 / 功能设计 / 代码实现 / 调试 / 文档整理；
告诉我你准备查看或修改哪些主要文件；
如果要修改多个文件，先给简短计划；
然后开始执行；
执行过程中同步维护 /Docs；
结束前更新：
[[当前状态]]
[[会话日志]]
[[当前任务]]
[[下一步]]
相关功能模块文档；
最后给我一个简洁 summary。

如果只是阅读代码，不要大规模重写文档。
如果只是小改动，不要创建一堆新文档。
如果是新功能，请为该功能创建独立文件夹。

## 5. 开发自主权

你可以根据任务需要自行判断应该查看、修改或创建哪些文件。

但请遵守：

不要做和任务无关的大范围重构；
不要为了“顺手优化”修改无关代码；
不要在没有必要时修改配置、依赖、构建脚本；
不要把 v1 旧栈当作新功能的长期实现基础；
不要新增复杂架构，除非这个功能确实需要；
修改前先说明计划；
如果发现更好的实现路径，可以主动建议；
如果发现我的思路有问题，可以直接指出。

如果我明确说“可以直接改”，你可以直接修改相关文件。
如果风险较大，先停下来问我。
