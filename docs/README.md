# Cherry Studio Documentation

## Guides

| Document | Description |
|----------|-------------|
| [Development Setup](./guides/development.md) | Development environment setup |
| [Contributing](./guides/contributing.md) | How to contribute code |
| [Branching Strategy](./guides/branching-strategy.md) | Git branching workflow |
| [Test Plan](./guides/test-plan.md) | Test plan and release channels |
| [i18n Guide](./guides/i18n.md) | Internationalization guide |
| [Logging Guide](./guides/logging.md) | How to use the logger service |
| [Middleware](./guides/middleware.md) | How to write AI Provider middleware |

## References

### Architecture

| Document | Description |
|----------|-------------|
| [Architecture Overview](./references/architecture-overview.md) | System-wide architecture, process model, data flow |

### AI Core

| Document | Description |
|----------|-------------|
| [AI Core Architecture](./references/ai-core-architecture.md) | Complete data flow and architecture from user input to LLM response |

### Data System

| Document | Description |
|----------|-------------|
| [Data System Overview](./references/data/README.md) | System selection, architecture, and patterns |
| [Boot Config Overview](./references/data/boot-config-overview.md) | Early boot configuration system |
| [Boot Config Schema Guide](./references/data/boot-config-schema-guide.md) | Adding new boot config keys |
| [Cache Overview](./references/data/cache-overview.md) | Three-tier caching architecture |
| [Cache Usage](./references/data/cache-usage.md) | useCache hooks, CacheService examples |
| [Preference Overview](./references/data/preference-overview.md) | User settings management |
| [Preference Usage](./references/data/preference-usage.md) | usePreference hook examples |
| [Preference Schema Guide](./references/data/preference-schema-guide.md) | Adding new preference keys |
| [DataApi Overview](./references/data/data-api-overview.md) | Business data API architecture |
| [DataApi in Renderer](./references/data/data-api-in-renderer.md) | useQuery/useMutation patterns |
| [DataApi in Main](./references/data/data-api-in-main.md) | Handlers, Services, Repositories |
| [API Design Guidelines](./references/data/api-design-guidelines.md) | RESTful design rules |
| [API Types](./references/data/api-types.md) | API type system, schemas, error handling |
| [Database Patterns](./references/data/database-patterns.md) | DB naming, schema patterns |
| [Layered Preset Pattern](./references/data/best-practice-layered-preset-pattern.md) | Presets with user overrides |
| [V2 Migration Guide](./references/data/v2-migration-guide.md) | Migration system |

### Lifecycle System

| Document | Description |
|----------|-------------|
| [Lifecycle Overview](./references/lifecycle/README.md) | Architecture, decision guides, usage |
| [Application Overview](./references/lifecycle/application-overview.md) | Application bootstrap and shutdown |
| [Lifecycle Internals](./references/lifecycle/lifecycle-overview.md) | Phases, hooks, states |
| [Lifecycle Usage](./references/lifecycle/lifecycle-usage.md) | Full usage guide with examples |
| [Lifecycle Decision Guide](./references/lifecycle/lifecycle-decision-guide.md) | Lifecycle vs singleton decision |
| [Lifecycle Migration Guide](./references/lifecycle/lifecycle-migration-guide.md) | Migrating old services |

### Messaging

| Document | Description |
|----------|-------------|
| [Message System](./references/messaging/message-system.md) | Message lifecycle, state management, operations |

### Knowledge

| Document | Description |
|----------|-------------|
| [KnowledgeService](./references/knowledge/knowledge-service.md) | Concurrency control and workload management |

### CherryClaw (Autonomous Agent)

| Document | Description |
|----------|-------------|
| [CherryClaw Overview](./references/cherryclaw/overview.md) | Architecture, memory system, API |
| [Channel System](./references/cherryclaw/channels.md) | IM integration (Telegram, etc.) |
| [Claw MCP Server](./references/cherryclaw/mcp-claw.md) | Built-in MCP tools (cron, notify, skills, memory) |
| [Scheduler](./references/cherryclaw/scheduler.md) | Task-based polling scheduler |

### Components

| Document | Description |
|----------|-------------|
| [CodeBlockView](./references/components/code-block-view.md) | Code block view component |
| [Image Preview](./references/components/image-preview.md) | Image preview components |
| [Code Execution](./references/components/code-execution.md) | Python code execution via Pyodide |

### Other

| Document | Description |
|----------|-------------|
| [App Upgrade Config](./references/app-upgrade.md) | Application upgrade configuration |
| [Feishu Notify](./references/feishu-notify.md) | Feishu notification integration |
| [Fuzzy Search](./references/fuzzy-search.md) | Fuzzy search implementation |
| [LAN Transfer Protocol](./references/lan-transfer-protocol.md) | LAN file transfer protocol spec |
