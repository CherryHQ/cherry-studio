# Cherry Studio Rebranding Scope Document

> **Generated:** 2026-02-25
> **Project:** Cherry Studio (CherryHQ)
> **Total project files (excluding node_modules):** ~1,813 source/config files
> **Total TS/TSX source files:** 1,657
> **Files containing "cherry" references:** 317 unique files
> **Total "cherry" string occurrences:** ~1,646 (918 in TS/TSX + 728 in other files)
> **Total branded line occurrences across all file types:** ~982 (excluding pnpm-lock.yaml)

---

## Brand Tokens Summary

| Token | Approx. Occurrences | Example |
|---|---|---|
| `Cherry Studio` | 50+ | Product display name |
| `CherryStudio` | 30+ | Code identifiers, DB names |
| `cherrystudio` | 15+ | Protocol scheme, directory name |
| `@cherrystudio/` (workspace only) | 22 imports | npm scope for local workspace packages (external packages kept as-is) |
| `cherry-ai.com` | 25+ | Website, docs, releases, API |
| `CherryHQ` | 20+ | GitHub org, company name |
| `cherryin` / `CherryIN` | 290 | OAuth, provider branding |
| `com.kangfenmao.CherryStudio` | 3 | Bundle/App ID |
| `kangfenmao` | 21 | Original author handle in app ID, npm packages |
| `cherry-studio` | 10+ | Repo name, analytics channel |

---

## SECTION A: Package Identity (5 config files + 22 import files)

Renaming workspace packages will cascade into every file that imports them.

> **NOTE:** External published `@cherrystudio/*` packages (`openai`, `embedjs-*`, `analytics-client`) and `@kangfenmao/keyv-storage` are treated as regular third-party dependencies and are **excluded from rebranding scope**. They remain as-is in `package.json` and all 39 files importing them stay untouched.

### A1. Workspace Packages (3 packages)

| Package Name | Directory | Files Importing It |
|---|---|---|
| `@cherrystudio/ai-core` | `packages/aiCore/` | ~22 files (6 core + sub-exports) |
| `@cherrystudio/ai-sdk-provider` | `packages/ai-sdk-provider/` | ~3 files + peer dep |
| `@cherrystudio/extension-table-plus` | `packages/extension-table-plus/` | ~1 file |

### A2. Workspace Import Paths That Will Break (7 unique paths, 22 total imports)

| Import Path | Usage Count |
|---|---|
| `@cherrystudio/ai-core/provider` | 8 |
| `@cherrystudio/ai-core` | 6 |
| `@cherrystudio/ai-core/built-in/plugins` | 4 |
| `@cherrystudio/extension-table-plus` | 1 |
| `@cherrystudio/ai-sdk-provider` | 1 |
| `@cherrystudio/ai-core/core/plugins/built-in/webSearchPlugin/helper` | 1 |
| `@cherrystudio/ai-core/core/providers/schemas` | 1 |

### A3. External Packages — EXCLUDED FROM REBRANDING (kept as-is)

The following external npm packages remain unchanged. They are treated as regular third-party dependencies — no forking, no republishing, no import changes needed.

| Package | Version | Files Importing | Action |
|---|---|---|---|
| `@cherrystudio/openai` | 6.15.0 | 24 imports across 15 files | Keep as-is |
| `@cherrystudio/openai/resources` | 6.15.0 | 9 imports | Keep as-is |
| `@cherrystudio/openai/streaming` | 6.15.0 | 3 imports | Keep as-is |
| `@cherrystudio/openai/uploads` | 6.15.0 | 1 import | Keep as-is |
| `@cherrystudio/openai/resources/responses/responses` | 6.15.0 | 1 import | Keep as-is |
| `@cherrystudio/embedjs` | 0.1.31 | 5 imports | Keep as-is |
| `@cherrystudio/embedjs-interfaces` | 0.1.31 | 7 imports | Keep as-is |
| `@cherrystudio/embedjs-utils` | 0.1.31 | 3 imports | Keep as-is |
| `@cherrystudio/embedjs-loader-web` | 0.1.31 | 2 imports | Keep as-is |
| `@cherrystudio/embedjs-openai` | 0.1.31 | 1 import | Keep as-is |
| `@cherrystudio/embedjs-ollama` | 0.1.31 | 1 import | Keep as-is |
| `@cherrystudio/embedjs-loader-sitemap` | 0.1.31 | 1 import | Keep as-is |
| `@cherrystudio/embedjs-libsql` | 0.1.31 | 1 import | Keep as-is |
| `@cherrystudio/analytics-client` | ^1.1.0 | 4 imports | Keep as-is |
| `@kangfenmao/keyv-storage` | ^0.1.3 | 4 imports | Keep as-is |

**pnpm override stays:** `"openai": "npm:@cherrystudio/openai@6.15.0"`

**39 source files importing only external packages — NO CHANGES NEEDED:**

```
src/main/apiServer/routes/chat.ts
src/main/apiServer/services/chat-completion.ts
src/main/ipc.ts
src/main/knowledge/embedjs/embeddings/Embeddings.ts
src/main/knowledge/embedjs/embeddings/EmbeddingsFactory.ts
src/main/knowledge/embedjs/embeddings/VoyageEmbeddings.ts
src/main/knowledge/embedjs/loader/draftsExportLoader.ts
src/main/knowledge/embedjs/loader/epubLoader.ts
src/main/knowledge/embedjs/loader/index.ts
src/main/knowledge/embedjs/loader/noteLoader.ts
src/main/knowledge/embedjs/loader/odLoader.ts
src/main/services/AnalyticsService.ts
src/main/services/KnowledgeService.ts
src/main/services/remotefile/OpenAIService.ts
src/preload/index.ts
src/renderer/src/aiCore/legacy/clients/cherryai/CherryAiAPIClient.ts
src/renderer/src/aiCore/legacy/clients/openai/OpenAIApiClient.ts
src/renderer/src/aiCore/legacy/clients/openai/OpenAIBaseClient.ts
src/renderer/src/aiCore/legacy/clients/openai/OpenAIResponseAPIClient.ts
src/renderer/src/aiCore/legacy/clients/ovms/OVMSClient.ts
src/renderer/src/aiCore/legacy/clients/ppio/PPIOAPIClient.ts
src/renderer/src/aiCore/legacy/clients/types.ts
src/renderer/src/aiCore/legacy/clients/zhipu/ZhipuAPIClient.ts
src/renderer/src/aiCore/legacy/middleware/feat/ImageGenerationMiddleware.ts
src/renderer/src/aiCore/prepareParams/fileProcessor.ts
src/renderer/src/config/models/utils.ts
src/renderer/src/services/ModelMessageService.ts
src/renderer/src/services/SpanManagerService.ts
src/renderer/src/services/__tests__/ApiService.test.ts
src/renderer/src/services/__tests__/ModelMessageService.test.ts
src/renderer/src/store/messageBlock.ts
src/renderer/src/trace/dataHandler/StreamHandler.ts
src/renderer/src/types/aiCoreTypes.ts
src/renderer/src/types/file.ts
src/renderer/src/types/index.ts
src/renderer/src/types/newMessage.ts
src/renderer/src/types/provider.ts
src/renderer/src/types/sdk.ts
src/renderer/src/utils/mcp-tools.ts
```

### A4. Build Config / Alias Resolution Files (change once, fixes resolution)

| File | What to Change |
|---|---|
| `electron.vite.config.ts` | 5 `@cherrystudio/*` alias entries in renderer config |
| `tsconfig.web.json` | 6 `@cherrystudio/*` path mappings |
| `packages/aiCore/vitest.config.ts` | 1 `@cherrystudio/ai-sdk-provider` mock alias |
| `vitest.config.ts` | Inherits from above configs |
| `package.json` | `@cherrystudio/ai-core`, `@cherrystudio/extension-table-plus` workspace refs only (external deps stay) |
| `packages/aiCore/package.json` | `name`, `description`, `author`, `repository` |
| `packages/ai-sdk-provider/package.json` | `name`, `description`, `author`, `repository` |
| `packages/extension-table-plus/package.json` | `homepage`, `bugs.url` |

### A5. 22 Source Files With Workspace @cherrystudio Imports (NEED CHANGES)

```
packages/aiCore/src/__tests__/mocks/ai-sdk-provider.ts
packages/aiCore/src/__tests__/setup.ts
packages/aiCore/src/core/providers/schemas.ts
packages/aiCore/src/index.ts
packages/aiCore/vitest.config.ts
src/renderer/src/aiCore/index_new.ts
src/renderer/src/aiCore/middleware/AiSdkMiddlewareBuilder.ts
src/renderer/src/aiCore/plugins/PluginBuilder.ts
src/renderer/src/aiCore/plugins/reasoningTimePlugin.ts
src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts
src/renderer/src/aiCore/plugins/telemetryPlugin.ts
src/renderer/src/aiCore/prepareParams/parameterBuilder.ts
src/renderer/src/aiCore/provider/__tests__/integratedRegistry.test.ts
src/renderer/src/aiCore/provider/factory.ts
src/renderer/src/aiCore/provider/providerConfig.ts
src/renderer/src/aiCore/provider/providerInitialization.ts
src/renderer/src/aiCore/types/index.ts
src/renderer/src/aiCore/utils/__tests__/options.test.ts
src/renderer/src/aiCore/utils/options.ts
src/renderer/src/aiCore/utils/websearch.ts
src/renderer/src/components/RichEditor/useRichEditor.ts
src/renderer/src/utils/prompt.ts
```

---

## SECTION B: App Identity & Metadata (15 files)

| File | Lines | What to Change |
|---|---|---|
| `package.json` | 2,5,6,8,9 | `name`, `description`, `desktopName`, `author`, `homepage` |
| `electron-builder.yml` | 1,2,6,17-19,77,87-88,114,123-124,126 | `appId`, `productName`, `protocols`, `executableName`, `StartupWMClass`, MIME type |
| `src/main/index.ts` | 31,49-50,86-87,145,233 | Protocol import, crash reporter, window class, app model ID |
| `src/renderer/src/config/env.ts` | 4 | `APP_NAME = 'Cherry Studio'` |
| `src/main/services/ProtocolClient.ts` | 15,20,24,58,90,94 | Protocol constant, desktop file name, desktop entry |
| `src/main/services/SelectionService.ts` | 533 | Bundle ID check |
| `src/main/services/NodeTraceService.ts` | 13 | `TRACER_NAME = 'CherryStudio'` |
| `src/renderer/src/services/SpanManagerService.ts` | 368 | Tracer name `'CherryStudio'` |
| `src/renderer/src/services/WebTraceService.ts` | 9 | `TRACER_NAME = 'CherryStudio'` |
| `src/main/services/agents/plugins/PluginService.ts` | 403 | User-Agent header |
| `src/main/services/WebviewService.ts` | 10,15 | UA string stripping regex |
| `src/main/utils/file.ts` | 146 | Temp dir name `'CherryStudio'` |
| `src/main/utils/__tests__/file.test.ts` | 229 | Test assertion for temp dir |
| `scripts/notarize.js` | appBundleId line | `'com.kangfenmao.CherryStudio'` |
| `src/renderer/src/utils/export.ts` | 975 | Siyuan root path default `'CherryStudio'` |

---

## SECTION C: Database & Storage (4 files + 14 consumers) -- DATA MIGRATION RISK

| File | Line | Current Value | Risk |
|---|---|---|---|
| `src/renderer/src/databases/index.ts` | 31 | `new Dexie('CherryStudio')` | **Users lose all chat data** without migration |
| `packages/shared/config/constant.ts` | 492 | `HOME_CHERRY_DIR = '.cherrystudio'` | **Users lose config/data** without migration |
| `src/main/services/agents/database/DatabaseManager.ts` | - | Uses HOME_CHERRY_DIR | Agent data stored under `.cherrystudio` |
| `src/main/services/agents/drizzle.config.ts` | - | DB config path | Under `.cherrystudio` |

### Files Consuming HOME_CHERRY_DIR (14 files)

```
src/main/services/CodeToolsService.ts        (lines 73, 623, 650, 761, 822, 908, 957)
src/main/services/MCPService.ts              (line 946)
src/main/services/ocr/builtin/OvOcrService.ts (lines 17, 34)
src/main/services/SpanCacheService.ts        (line 22)
src/main/services/OvmsManager.ts             (lines 137, 187, 265, 296, 347, 460, 487, 540)
src/main/utils/file.ts                       (lines 163, 175)
src/main/utils/init.ts                       (line 6)
src/main/services/agents/database/DatabaseManager.ts
src/main/services/agents/drizzle.config.ts
```

---

## SECTION D: CherryIN Provider & OAuth (40 files, 290 occurrences)

This is a sub-brand ("CherryIN") that needs separate decisions: remove, rename, or keep.

### Core CherryIN Files

| Category | Files |
|---|---|
| OAuth service | `src/main/services/CherryINOAuthService.ts` |
| OAuth UI | `src/renderer/src/pages/settings/ProviderSettings/CherryINOAuth.tsx` |
| Provider settings | `src/renderer/src/pages/settings/ProviderSettings/CherryINSettings.tsx` |
| SDK provider | `packages/ai-sdk-provider/src/cherryin-provider.ts` (filename itself) |
| Provider config | `src/renderer/src/config/providers.ts` (cherryin provider ID, logo, API host) |
| Shared constants | `packages/shared/config/constant.ts` (CHERRYIN_CONFIG, redirect URI, allowed hosts) |
| IPC channel | `packages/shared/IpcChannel.ts` (CherryIN_Logout channel) |
| Preload bridge | `src/preload/index.ts` (cherryin.logout API) |
| IPC handler | `src/main/ipc.ts` (IpcChannel.CherryIN_Logout handler) |
| Type definitions | `src/renderer/src/types/index.ts`, `src/renderer/src/types/provider.ts` ('cherryin' in union types) |
| Provider image | `src/renderer/src/assets/images/providers/cherryin.png` |
| i18n labels | `src/renderer/src/i18n/label.ts` |
| Store/migration | `src/renderer/src/store/migrate.ts` |

### All 40 Files With CherryIN References

```
packages/ai-sdk-provider/src/cherryin-provider.ts
packages/ai-sdk-provider/src/index.ts
packages/aiCore/src/__tests__/mocks/ai-sdk-provider.ts
packages/aiCore/src/core/plugins/built-in/webSearchPlugin/index.ts
packages/aiCore/src/core/providers/__tests__/schemas.test.ts
packages/aiCore/src/core/providers/schemas.ts
packages/shared/IpcChannel.ts
packages/shared/config/constant.ts
src/main/apiServer/utils/index.ts
src/main/ipc.ts
src/main/services/CherryINOAuthService.ts
src/main/services/OpenClawService.ts
src/preload/index.ts
src/renderer/src/aiCore/provider/factory.ts
src/renderer/src/aiCore/provider/providerConfig.ts
src/renderer/src/aiCore/utils/__tests__/options.test.ts
src/renderer/src/aiCore/utils/options.ts
src/renderer/src/aiCore/utils/reasoning.ts
src/renderer/src/aiCore/utils/websearch.ts
src/renderer/src/components/FreeTrialModelTag.tsx
src/renderer/src/config/models/default.ts
src/renderer/src/config/providers.ts
src/renderer/src/i18n/label.ts
src/renderer/src/pages/code/index.ts
src/renderer/src/pages/settings/ProviderSettings/AddProviderPopup.tsx
src/renderer/src/pages/settings/ProviderSettings/CherryINOAuth.tsx
src/renderer/src/pages/settings/ProviderSettings/CherryINSettings.tsx
src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx
src/renderer/src/services/ProviderService.ts
src/renderer/src/services/__tests__/ApiService.test.ts
src/renderer/src/store/llm.ts
src/renderer/src/store/migrate.ts
src/renderer/src/store/settings.ts
src/renderer/src/types/index.ts
src/renderer/src/types/provider.ts
src/renderer/src/utils/__tests__/api.test.ts
src/renderer/src/utils/__tests__/provider.test.ts
src/renderer/src/utils/naming.ts
src/renderer/src/utils/oauth.ts
src/renderer/src/utils/provider.ts
```

---

## SECTION E: Environment Variables & Secrets (7 files)

| File | Variable | Occurrences |
|---|---|---|
| `src/main/config.ts` | `global.CHERRYAI_CLIENT_SECRET = import.meta.env.MAIN_VITE_CHERRYAI_CLIENT_SECRET` | 1 |
| `src/main/env.d.ts` | `VITE_MAIN_BUNDLE_ID` type declaration | 1 |
| `.github/workflows/nightly-build.yml` | `MAIN_VITE_CHERRYAI_CLIENT_SECRET` | 3 |
| `.github/workflows/release.yml` | `MAIN_VITE_CHERRYAI_CLIENT_SECRET` | 3 |
| `.github/workflows/sync-to-gitcode.yml` | `MAIN_VITE_CHERRYAI_CLIENT_SECRET` | 1 |
| `src/main/services/agents/services/claudecode/index.ts` | `CHERRY_AUTO_ALLOW_TOOLS` | 2 |
| `src/main/services/agents/services/claudecode/tool-permissions.ts` | `CHERRY_AUTO_ALLOW_TOOLS` | 1 |

---

## SECTION F: HTML Window Titles (4 files)

| File | Current Title |
|---|---|
| `src/renderer/index.html` | `<title>Cherry Studio</title>` |
| `src/renderer/miniWindow.html` | `<title>Cherry Studio Quick Assistant</title>` |
| `src/renderer/selectionAction.html` | `<title>Cherry Studio Selection Assistant</title>` |
| `src/renderer/selectionToolbar.html` | `<title>Cherry Studio Selection Toolbar</title>` |

---

## SECTION G: URLs & External Endpoints (~25 files, 50+ occurrences)

| URL Pattern | Example Files | Purpose |
|---|---|---|
| `cherry-ai.com` | AboutSettings, AppMenuService, constant.ts | Main website |
| `docs.cherry-ai.com` | 8+ settings pages, issue templates | Documentation |
| `releases.cherry-ai.com` | constant.ts, app-upgrade-config.json | Auto-update feed |
| `api.cherry-ai.com` | providers.ts | CherryIN API |
| `enterprise.cherry-ai.com` | AboutSettings.tsx | Enterprise page |
| `open.cherryin.ai` / `open.cherryin.dev` | CherryINOAuth, constant.ts | OAuth provider |
| `github.com/CherryHQ/cherry-studio` | 20+ files | GitHub repo |
| `support@cherry-ai.com` | package.json, AboutSettings, privacy pages | Support email |
| `bd@cherry-ai.com` | license.html | Business email |
| HTTP Referer: `cherry-ai.com` | BaseWebSearchProvider.ts, mcprouter.ts | HTTP headers |

### Key Files With URL References

```
src/renderer/src/pages/settings/AboutSettings.tsx
src/main/services/AppMenuService.ts
packages/shared/config/constant.ts
app-upgrade-config.json
config/app-upgrade-segments.json
src/renderer/src/config/providers.ts
src/renderer/src/pages/settings/DataSettings/NotionSettings.tsx
src/renderer/src/pages/settings/DataSettings/S3Settings.tsx
src/renderer/src/pages/settings/DataSettings/SiyuanSettings.tsx
src/renderer/src/pages/settings/MCPSettings/BuiltinMCPServerList.tsx
src/renderer/src/pages/settings/MCPSettings/InstallNpxUv.tsx
src/renderer/src/store/mcp.ts
src/renderer/src/pages/store/assistants/presets/components/ImportAssistantPresetPopup.tsx
src/renderer/src/providers/WebSearchProvider/BaseWebSearchProvider.ts
src/renderer/src/pages/settings/MCPSettings/providers/mcprouter.ts
src/renderer/src/utils/oauth.ts
build/nsis-installer.nsh
resources/cherry-studio/privacy-en.html
resources/cherry-studio/privacy-zh.html
resources/cherry-studio/releases.html
```

---

## SECTION H: Visual Assets (15+ files)

### Build Assets (replace all with new brand imagery)

```
build/icon.icns                    -- macOS icon
build/icon.ico                     -- Windows icon
build/icon.png                     -- Generic icon
build/logo.png                     -- Logo
build/tray_icon.png                -- System tray (default)
build/tray_icon_dark.png           -- System tray (dark)
build/tray_icon_light.png          -- System tray (light)
build/icons/16x16.png              -- Multi-resolution icons
build/icons/24x24.png
build/icons/32x32.png
build/icons/48x48.png
build/icons/64x64.png
build/icons/128x128.png
build/icons/256x256.png
build/icons/512x512.png
build/icons/1024x1024.png
```

### Renderer Assets

```
src/renderer/src/assets/images/logo.png               -- In-app logo
src/renderer/src/assets/images/cherry-text-logo.svg    -- Text logo (used in NpxSearch)
src/renderer/src/assets/images/avatar.png              -- Default avatar
src/renderer/src/assets/images/providers/cherryin.png  -- CherryIN provider logo
```

### Files Referencing These Assets

```
src/renderer/src/config/env.ts                                    -- AppLogo import
src/renderer/src/pages/settings/MCPSettings/NpxSearch.tsx          -- cherry-text-logo.svg import
src/renderer/src/config/providers.ts                               -- cherryin.png import
src/renderer/src/pages/settings/ProviderSettings/CherryINOAuth.tsx -- cherryin.png import
src/renderer/index.html                                            -- logo.png in <img>
```

---

## SECTION I: Localization (11 locale files, ~173 total lines)

| File | Cherry Count |
|---|---|
| `src/renderer/src/i18n/locales/en-us.json` | 15 |
| `src/renderer/src/i18n/locales/zh-cn.json` | 15 |
| `src/renderer/src/i18n/locales/zh-tw.json` | 16 |
| `src/renderer/src/i18n/translate/de-de.json` | 15 |
| `src/renderer/src/i18n/translate/el-gr.json` | 16 |
| `src/renderer/src/i18n/translate/es-es.json` | 16 |
| `src/renderer/src/i18n/translate/fr-fr.json` | 19 |
| `src/renderer/src/i18n/translate/ja-jp.json` | 16 |
| `src/renderer/src/i18n/translate/pt-pt.json` | 16 |
| `src/renderer/src/i18n/translate/ro-ro.json` | 14 |
| `src/renderer/src/i18n/translate/ru-ru.json` | 15 |

### Key Branded Strings in Locale Files

- "Cherry Studio" in permission request strings
- "Cherry Studio peers" for LAN transfer
- "CherryIN" provider label
- OpenAPI description mentioning "Cherry Studio"
- "Cherry Studio.exe" in Windows examples
- `.cherrystudio` path references (e.g. OVMS install path)

---

## SECTION J: CI/CD Workflows (5 files)

| File | Cherry References |
|---|---|
| `.github/workflows/nightly-build.yml` | Artifact prefix `cherry-studio-nightly-`, repo check `CherryHQ/cherry-studio`, env vars `MAIN_VITE_CHERRYAI_CLIENT_SECRET` |
| `.github/workflows/release.yml` | `MAIN_VITE_CHERRYAI_CLIENT_SECRET`, repo checks |
| `.github/workflows/sync-to-gitcode.yml` | Env vars, repo references |
| `.github/workflows/dispatch-docs-update.yml` | Cherry references |
| `.github/workflows/issue-management.yml` | Cherry references |

---

## SECTION K: Resources & Legal (5 files + branded directory)

| File | Content |
|---|---|
| `resources/cherry-studio/` | **Directory name itself** needs renaming |
| `resources/cherry-studio/license.html` | Full license text with "Cherry Studio" throughout, `bd@cherry-ai.com` |
| `resources/cherry-studio/privacy-en.html` | Privacy policy: "Cherry Studio", `CherryHQ`, `support@cherry-ai.com`, GitHub URL |
| `resources/cherry-studio/privacy-zh.html` | Chinese privacy policy, same references |
| `resources/cherry-studio/releases.html` | `kangfenmao/cherry-studio` GitHub API fetch URL |

### Files Referencing resource/cherry-studio/ Directory

Any code loading license, privacy, or releases HTML pages must update paths after directory rename.

---

## SECTION L: Documentation (20+ files)

```
README.md                                           -- Main readme with all branding
CONTRIBUTING.md                                     -- WeChat: kangfenmao, community links
SECURITY.md                                         -- Security contact
docs/README.md
docs/en/guides/branching-strategy.md
docs/en/guides/logging.md
docs/en/guides/test-plan.md
docs/en/references/app-upgrade.md
docs/en/references/components/code-block-view.md
docs/en/references/components/image-preview.md
docs/en/references/fuzzy-search.md
docs/zh/README.md
docs/zh/guides/branching-strategy.md
docs/zh/guides/contributing.md
docs/zh/guides/logging.md
docs/zh/guides/memory.md
docs/zh/guides/test-plan.md
docs/zh/references/app-upgrade.md
docs/zh/references/components/code-block-view.md
docs/zh/references/components/image-preview.md
docs/zh/references/database.md
docs/zh/references/fuzzy-search.md
docs/zh/references/lan-transfer-protocol.md
docs/zh/references/message-system.md
.agents/skills/gh-create-pr/SKILL.md
.agents/skills/prepare-release/SKILL.md
.claude/skills/gh-create-pr/SKILL.md
.claude/skills/prepare-release/SKILL.md
packages/aiCore/README.md
packages/aiCore/AI_SDK_ARCHITECTURE.md
packages/aiCore/src/core/plugins/README.md
packages/ai-sdk-provider/README.md
src/main/mcpServers/hub/README.md
src/main/services/agents/README.md
src/renderer/src/aiCore/AI_CORE_DESIGN.md
src/renderer/src/aiCore/legacy/middleware/MIDDLEWARE_SPECIFICATION.md
tests/e2e/README.md
```

---

## SECTION M: Build Scripts (4 files)

| File | What |
|---|---|
| `scripts/notarize.js` | `appBundleId: 'com.kangfenmao.CherryStudio'` |
| `scripts/cloudflare-worker.js` | `kangfenmao/cherry-studio` GitHub API URL |
| `scripts/win-sign.js` | May contain branding |
| `build/nsis-installer.nsh` | `www.cherry-ai.com` URL |

---

## SECTION N: GitHub Templates (5 files)

| File | Cherry References |
|---|---|
| `.github/ISSUE_TEMPLATE/0_bug_report.yml` | "Cherry Studio" in version fields, `docs.cherry-ai.com` |
| `.github/ISSUE_TEMPLATE/1_feature_request.yml` | Cherry references |
| `.github/ISSUE_TEMPLATE/2_question.yml` | Cherry references |
| `.github/ISSUE_TEMPLATE/3_others.yml` | Cherry references |
| `.github/pull_request_template.md` | `CherryHQ/cherry-studio` contributing link, `docs.cherry-ai.com` |

---

## SECTION O: Test Files With Branded Assertions (9 files)

| File | What |
|---|---|
| `src/main/utils/__tests__/file.test.ts` | `expect(tempDir).toBe('/mock/temp/CherryStudio')` |
| `src/renderer/src/utils/__tests__/markdownConverter.test.ts` | `CherryStudioDev` in test fixtures |
| `src/renderer/src/utils/__tests__/api.test.ts` | `open.cherryin.net` in test URLs |
| `src/renderer/src/utils/__tests__/provider.test.ts` | CherryIN provider tests |
| `src/renderer/src/aiCore/provider/__tests__/providerConfig.test.ts` | Cherry refs |
| `src/renderer/src/aiCore/utils/__tests__/websearch.test.ts` | Cherry refs |
| `src/main/services/__tests__/LocalTransferService.test.ts` | Service name |
| `src/main/services/__tests__/BackupManager.deleteTempBackup.test.ts` | Cherry refs |
| `packages/shared/__tests__/utils.test.ts` | Cherry refs |
| `packages/aiCore/src/__tests__/setup.ts` | `@cherrystudio` mock |
| `src/renderer/src/services/__tests__/ApiService.test.ts` | Cherry refs |
| `src/renderer/src/services/__tests__/ModelMessageService.test.ts` | Cherry refs |
| `src/renderer/src/aiCore/utils/__tests__/options.test.ts` | Cherry refs |
| `src/renderer/src/aiCore/provider/__tests__/integratedRegistry.test.ts` | Cherry refs |
| `src/main/services/lanTransfer/__tests__/LanTransferClientService.test.ts` | Cherry refs |
| `src/main/services/lanTransfer/__tests__/handlers/connection.test.ts` | Cherry refs |
| `src/main/__tests__/mcp.test.ts` | Cherry refs |
| `src/main/utils/__tests__/shell-env.test.ts` | Cherry refs |

---

## SECTION P: Miscellaneous Files With Cherry References

```
src/main/apiServer/app.ts
src/main/apiServer/middleware/openapi.ts
src/main/config.ts
src/main/constant.ts
src/main/services/AppService.ts
src/main/services/BackupManager.ts
src/main/services/CacheService.ts
src/main/services/ConfigManager.ts
src/main/services/LocalTransferService.ts
src/main/services/NutstoreService.ts
src/main/services/ReduxService.ts
src/main/services/ShortcutService.ts
src/main/services/StoreSyncService.ts
src/main/services/TrayService.ts
src/main/services/mcp/oauth/provider.ts
src/main/services/urlschema/handle-providers.ts
src/main/services/urlschema/mcp-install.ts
src/main/utils/index.ts
src/main/utils/process.ts
src/main/utils/shell-env.ts
src/main/utils/systemInfo.ts
src/main/mcpServers/browser/server.ts
src/main/mcpServers/dify-knowledge.ts
src/main/mcpServers/hub/toolname.ts
src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts
src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts
src/renderer/src/aiCore/index.ts
src/renderer/src/aiCore/legacy/clients/ApiClientFactory.ts
src/renderer/src/aiCore/prepareParams/messageConverter.ts
src/renderer/src/aiCore/utils/reasoning.ts
src/renderer/src/components/FreeTrialModelTag.tsx
src/renderer/src/components/LocalBackupModals.tsx
src/renderer/src/components/ObsidianExportDialog.tsx
src/renderer/src/components/Popups/PrivacyPopup.tsx
src/renderer/src/components/Popups/SelectModelPopup/api-model-popup.tsx
src/renderer/src/components/Popups/SelectModelPopup/popup.tsx
src/renderer/src/components/S3Modals.tsx
src/renderer/src/components/WebdavModals.tsx
src/renderer/src/config/models/default.ts
src/renderer/src/databases/upgrades.ts
src/renderer/src/hooks/useProvider.ts
src/renderer/src/hooks/useSettings.ts
src/renderer/src/hooks/useShortcuts.ts
src/renderer/src/hooks/useStore.ts
src/renderer/src/pages/code/CodeToolsPage.tsx
src/renderer/src/pages/code/index.ts
src/renderer/src/pages/paintings/NewApiPage.tsx
src/renderer/src/pages/paintings/config/DmxapiConfig.ts
src/renderer/src/pages/settings/DataSettings/NutstoreSettings.tsx
src/renderer/src/pages/settings/DisplaySettings/DisplaySettings.tsx
src/renderer/src/pages/settings/MCPSettings/providers/bailian.ts
src/renderer/src/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings.tsx
src/renderer/src/pages/settings/SelectionAssistantSettings/components/SelectionActionSearchModal.tsx
src/renderer/src/services/ApiService.ts
src/renderer/src/services/BackupService.ts
src/renderer/src/services/KnowledgeService.ts
src/renderer/src/services/NutstoreService.ts
src/renderer/src/services/ProviderService.ts
src/renderer/src/services/db/AgentMessageDataSource.ts
src/renderer/src/services/db/DbService.ts
src/renderer/src/services/db/DexieMessageDataSource.ts
src/renderer/src/services/db/index.ts
src/renderer/src/services/import/importers/ChatGPTImporter.ts
src/renderer/src/store/assistants.ts
src/renderer/src/store/backup.ts
src/renderer/src/store/codeTools.ts
src/renderer/src/store/copilot.ts
src/renderer/src/store/index.ts
src/renderer/src/store/inputTools.ts
src/renderer/src/store/knowledge.ts
src/renderer/src/store/llm.ts
src/renderer/src/store/mcp.ts
src/renderer/src/store/memory.ts
src/renderer/src/store/minapps.ts
src/renderer/src/store/newMessage.ts
src/renderer/src/store/note.ts
src/renderer/src/store/nutstore.ts
src/renderer/src/store/ocr.ts
src/renderer/src/store/paintings.ts
src/renderer/src/store/preprocess.ts
src/renderer/src/store/runtime.ts
src/renderer/src/store/selectionStore.ts
src/renderer/src/store/settings.ts
src/renderer/src/store/shortcuts.ts
src/renderer/src/store/tabs.ts
src/renderer/src/store/thunk/knowledgeThunk.ts
src/renderer/src/store/thunk/messageThunk.ts
src/renderer/src/store/toolPermissions.ts
src/renderer/src/store/translate.ts
src/renderer/src/store/websearch.ts
src/renderer/src/utils/export.ts
src/renderer/src/utils/markdown.ts
src/renderer/src/utils/model.ts
src/renderer/src/workers/pyodide.worker.ts
src/renderer/src/env.d.ts
src/renderer/src/init.ts
src/renderer/src/windows/mini/entryPoint.tsx
src/renderer/src/windows/selection/action/entryPoint.tsx
.oxlintrc.json
eslint.config.mjs
```

---

## GRAND TOTALS

| Category | Files | String Occurrences | Priority |
|---|---|---|---|
| **A. Workspace package names & imports** | 30 files | ~22 import statements + 8 config files | CRITICAL |
| **B. App identity** | 15 files | ~30 | CRITICAL |
| **C. Database & storage** | 4 files + 14 consumers | ~20 | CRITICAL (migration risk) |
| **D. CherryIN provider** | 40 files | ~290 | HIGH |
| **E. Env variables** | 7 files | ~11 | HIGH |
| **F. HTML titles** | 4 files | 4 | HIGH |
| **G. URLs & endpoints** | 25 files | ~50 | HIGH |
| **H. Visual assets** | 15+ files | N/A (binary) | MEDIUM |
| **I. Localization** | 11 files | ~173 | MEDIUM |
| **J. CI/CD** | 5 files | ~20 | MEDIUM |
| **K. Resources & legal** | 5 files | ~30 | MEDIUM |
| **L. Documentation** | 20+ files | ~100+ | LOW |
| **M. Build scripts** | 4 files | ~5 | MEDIUM |
| **N. GitHub templates** | 5 files | ~10 | LOW |
| **O. Test assertions** | 18 files | ~30 | MEDIUM |
| **P. Miscellaneous** | 90+ files | ~200+ | VARIES |
| **TOTAL** | **~278 unique files** | **~920+ lines** | |

> **Note:** 39 files importing only external `@cherrystudio/*` packages are excluded from scope (see Section A3).

---

## Migration Risks

1. **IndexedDB name change** (`CherryStudio` in Dexie) - will cause data loss without migration logic
2. **Config directory change** (`.cherrystudio`) - existing settings/data inaccessible
3. **Protocol scheme change** (`cherrystudio://`) - breaks existing deep links and OAuth redirects
4. **OAuth redirect URI** - must be re-registered with the OAuth provider
5. **Auto-update URLs** - existing installed users won't receive updates unless old URLs redirect to new ones
6. **pnpm-lock.yaml** - will regenerate automatically but must be committed

---

## Recommended Execution Order

1. **Phase 1 -- Workspace package rename** (highest impact): Rename `@cherrystudio/*` scope in 3 workspace packages + update tsconfig paths + electron.vite.config aliases + 22 import files
2. **Phase 2 -- App identity**: electron-builder.yml, package.json root, protocol handler, crash reporter, HTML titles
3. **Phase 3 -- Database migration**: Write migration code BEFORE renaming IndexedDB name and `HOME_CHERRY_DIR`
4. **Phase 4 -- CherryIN sub-brand**: Decide: remove, rename, or keep. 40 files, 290 occurrences
5. **Phase 5 -- URLs, env vars, assets**: Bulk find-replace for domains, secrets, images
6. **Phase 6 -- i18n, docs, CI/CD, tests**: Mechanical string replacement
7. **Phase 7 -- Verification**: Run `pnpm lint && pnpm test && pnpm build:check` to catch any missed references

> **Excluded from phases:** External npm packages (`@cherrystudio/openai`, `@cherrystudio/embedjs-*`, `@cherrystudio/analytics-client`, `@kangfenmao/keyv-storage`) are kept as-is — treated as regular third-party dependencies with no changes needed.

> **After rebranding:** Follow [docs/upstream_sync_guide.md](upstream_sync_guide.md) for safely pulling upstream bug fixes without overwriting rebranded files.
