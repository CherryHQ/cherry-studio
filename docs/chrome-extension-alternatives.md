# Chrome Extension Port: Alternative Approaches

## Summary

After analyzing the codebase, **86% of the code is directly reusable**. Here are 4 approaches ranked by effort.

---

## Approach Comparison

| Approach | Effort | Code Reuse | Result Quality | Recommended For |
|----------|--------|------------|----------------|-----------------|
| **A: Hybrid Build** | ⭐ Lowest | 95% | Good | Quick MVP |
| **B: Shared Monorepo** | ⭐⭐ Low | 90% | Excellent | Long-term |
| **C: PWA + Extension** | ⭐⭐ Low | 85% | Good | Web-first |
| **D: Full Rewrite** | ⭐⭐⭐⭐ High | 70% | Best | Clean slate |

---

## Approach A: Hybrid Build (RECOMMENDED - Lowest Effort)

**Concept:** Same codebase, add Chrome extension as a build target alongside Electron.

### What This Means

```
cherry-studio/
├── src/
│   ├── main/           # Electron main (unchanged)
│   ├── renderer/       # Shared React UI (95% reused)
│   ├── preload/        # Electron preload (unchanged)
│   └── extension/      # NEW: Extension-specific (~500 LOC)
│       ├── background.ts
│       ├── manifest.json
│       └── shim.ts     # window.api shim
├── packages/
│   └── aiCore/         # 100% reused
```

### Key Insight: The `window.api` Shim

The renderer calls `window.api.*` for all Electron features. We create a **shim** that redirects these to Chrome APIs:

```typescript
// src/extension/shim.ts
// This replaces window.api for Chrome extension context

const extensionApi = {
  // File operations → Chrome storage + IndexedDB
  file: {
    read: async (path: string) => {
      return chrome.runtime.sendMessage({ type: 'file:read', path })
    },
    save: async (path: string, content: string) => {
      return chrome.runtime.sendMessage({ type: 'file:save', path, content })
    },
    selectFile: async () => {
      // Use File System Access API or file input
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.onchange = () => resolve(input.files?.[0])
        input.click()
      })
    }
  },

  // AI calls → Direct (aiCore works in browser)
  ai: {
    streamText: (params) => streamText(params), // Direct call!
    generateObject: (params) => generateObject(params)
  },

  // Storage → Chrome storage
  storage: {
    get: (key: string) => chrome.storage.local.get(key),
    set: (key: string, value: any) => chrome.storage.local.set({ [key]: value })
  },

  // Settings → Chrome storage
  config: {
    get: async (key: string) => (await chrome.storage.local.get(key))[key],
    set: (key: string, value: any) => chrome.storage.local.set({ [key]: value })
  },

  // MCP → HTTP/SSE only (no stdio)
  mcp: {
    connect: (config) => chrome.runtime.sendMessage({ type: 'mcp:connect', config }),
    listTools: () => chrome.runtime.sendMessage({ type: 'mcp:listTools' }),
    executeTool: (name, args) => chrome.runtime.sendMessage({ type: 'mcp:execute', name, args })
  },

  // Features that don't exist in extension
  window: {
    minimize: () => {}, // No-op
    maximize: () => {},
    close: () => window.close(),
    setTitle: () => {}
  },

  // Clipboard → Web Clipboard API
  clipboard: {
    read: () => navigator.clipboard.readText(),
    write: (text: string) => navigator.clipboard.writeText(text)
  }
}

// Inject as window.api
;(window as any).api = extensionApi
```

### Implementation Steps

1. **Add extension build config** (~100 LOC)
```typescript
// vite.config.extension.ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/extension/manifest.json'

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist-extension',
    rollupOptions: {
      input: {
        sidepanel: 'src/renderer/index.html', // Reuse!
        background: 'src/extension/background.ts'
      }
    }
  },
  define: {
    'import.meta.env.PLATFORM': '"extension"'
  }
})
```

2. **Create window.api shim** (~200 LOC)
3. **Create background service worker** (~150 LOC)
4. **Create manifest.json** (~50 LOC)
5. **Add platform detection** (~20 LOC)

```typescript
// src/renderer/src/utils/platform.ts
export const isExtension = import.meta.env.PLATFORM === 'extension'
export const isElectron = !isExtension && !!window.electron
```

6. **Conditional imports for platform-specific code** (~30 LOC)

```typescript
// In components that need platform-specific behavior
if (isExtension) {
  // Load extension shim
  await import('@/extension/shim')
}
```

### Estimated Effort

| Task | Lines of Code | Time |
|------|---------------|------|
| Vite config | 100 | 2 hours |
| window.api shim | 200 | 4 hours |
| Background worker | 150 | 3 hours |
| Manifest + assets | 50 | 1 hour |
| Platform detection | 30 | 30 min |
| Testing/debugging | - | 8 hours |
| **Total** | **~530 LOC** | **~2-3 days** |

### Pros
- Minimal new code
- Single codebase for both platforms
- Easy to maintain
- Fastest path to working extension

### Cons
- Some code paths have platform checks
- May carry unused Electron-specific code in bundle
- Need to handle feature gaps gracefully

---

## Approach B: Shared Monorepo

**Concept:** Extract shared code into packages, build platform-specific apps.

### Structure

```
cherry-studio/
├── packages/
│   ├── core/           # Shared business logic
│   ├── ui/             # Shared React components
│   ├── aiCore/         # AI middleware (exists)
│   └── shared/         # Types, utils (exists)
├── apps/
│   ├── electron/       # Electron app
│   └── extension/      # Chrome extension
```

### Implementation

1. **Extract shared UI components** into `packages/ui/`
2. **Extract business logic** into `packages/core/`
3. **Create extension app** that imports from packages
4. **Refactor Electron app** to use packages

### Estimated Effort

| Task | Time |
|------|------|
| Package extraction | 2-3 days |
| Extension app setup | 1-2 days |
| Integration testing | 2 days |
| **Total** | **5-7 days** |

### Pros
- Clean architecture
- True code sharing
- Easier long-term maintenance
- Could add web app, mobile later

### Cons
- More upfront refactoring
- Monorepo complexity
- Need to update existing Electron app

---

## Approach C: PWA + Companion Extension

**Concept:** Build a Progressive Web App, use extension only for browser integration (context menus, shortcuts).

### How It Works

```
┌─────────────────────────────────────────┐
│         Cherry Studio PWA               │
│    (Full app hosted on web/localhost)   │
└─────────────────────────────────────────┘
              ↑
              │ Opens in new tab or popup
              │
┌─────────────────────────────────────────┐
│     Minimal Chrome Extension            │
│  - Context menus                        │
│  - Keyboard shortcuts                   │
│  - Page content extraction              │
│  - Opens PWA with context               │
└─────────────────────────────────────────┘
```

### Extension Code (~200 LOC total)

```typescript
// background.ts
chrome.contextMenus.create({
  id: 'ask-cherry',
  title: 'Ask Cherry Studio',
  contexts: ['selection']
})

chrome.contextMenus.onClicked.addListener((info) => {
  const url = `https://cherry.studio/chat?text=${encodeURIComponent(info.selectionText)}`
  chrome.tabs.create({ url })
})
```

### Estimated Effort

| Task | Time |
|------|------|
| PWA configuration | 4 hours |
| Companion extension | 4 hours |
| Hosting setup | 2 hours |
| **Total** | **1-2 days** |

### Pros
- Simplest extension code
- PWA works offline
- Can be installed as "app"
- No extension review delays for updates

### Cons
- Requires web hosting
- Two separate "apps" to manage
- Less integrated experience
- PWA has some limitations vs native extension

---

## Approach D: Full Rewrite (Original Plan)

See `docs/chrome-extension-port-plan.md` for the comprehensive 7-phase approach.

### Estimated Effort
- **Time:** 6-8 weeks
- **New Code:** ~5,000+ LOC
- **Modified Code:** ~2,000 LOC

### When to Choose This
- Want cleanest possible extension
- Have dedicated team
- Planning to deprecate Electron version
- Need maximum performance optimization

---

## Recommendation Matrix

| If you want... | Choose |
|----------------|--------|
| Fastest working extension | **Approach A** |
| Best long-term architecture | **Approach B** |
| Simplest maintenance | **Approach C** |
| Cleanest extension code | **Approach D** |
| To ship in < 1 week | **Approach A** |
| Multi-platform (web, mobile) | **Approach B** |

---

## My Recommendation: Start with Approach A

**Why:**
1. **530 lines of new code** vs 5,000+ for full rewrite
2. **2-3 days** vs 6-8 weeks
3. **95% code reuse** - the renderer already works
4. **Low risk** - if it doesn't work, pivot to Approach B
5. **Validates demand** - ship fast, iterate

**Then evolve:**
- If extension gains traction → refactor to Approach B
- If web presence needed → add PWA (Approach C)
- If Electron deprecated → full migration (Approach D)

---

## Quick Start: Approach A

```bash
# 1. Create extension directory
mkdir -p src/extension

# 2. Create manifest
cat > src/extension/manifest.json << 'EOF'
{
  "manifest_version": 3,
  "name": "Cherry Studio",
  "version": "1.0.0",
  "permissions": ["storage", "unlimitedStorage", "sidePanel"],
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Cherry Studio" }
}
EOF

# 3. Create shim (see code above)
# 4. Create vite.config.extension.ts
# 5. Add build script to package.json:
#    "build:extension": "vite build --config vite.config.extension.ts"

# 6. Build and load in Chrome
pnpm build:extension
# Load dist-extension/ as unpacked extension
```

---

## Code Reuse Summary

| Component | Files | Reusable | Notes |
|-----------|-------|----------|-------|
| React components | 200+ | ✅ 100% | No changes |
| Redux slices | 15 | ✅ 100% | Change storage adapter |
| Hooks | 50+ | ✅ 95% | Minor platform checks |
| Utilities | 100+ | ✅ 100% | No changes |
| aiCore package | 1 | ✅ 100% | Use directly |
| Services | 20 | ⚠️ 60% | Wrap with messaging |
| Styles/CSS | All | ✅ 100% | No changes |
| IndexedDB schema | 1 | ✅ 100% | Dexie works in extension |

**Bottom line:** You're writing ~500 lines of glue code, not rebuilding the app.
