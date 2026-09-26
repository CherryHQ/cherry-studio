---
title: Use Single Dependency Versions Across Monorepo
impact: MEDIUM
impactDescription: avoids duplicate bundles, version conflicts
tags: monorepo, dependencies, installation
---

## Use Single Dependency Versions Across Monorepo

Use a single version of each dependency across all packages in your monorepo.
Prefer exact versions over ranges. Multiple versions cause duplicate code in
bundles, runtime conflicts, and inconsistent behavior across packages.

Use a tool like syncpack to enforce this. As a last resort, use yarn resolutions
or npm overrides.

**Incorrect (version ranges, multiple versions):**

```json
// packages/app/package.json
{
  "dependencies": {
    "react-native-reanimated": "^3.0.0"
  }
}

// packages/ui/package.json
{
  "dependencies": {
    "react-native-reanimated": "^3.5.0"
  }
}
```

**Correct (exact versions, single source of truth):**

```json
// package.json (root)
{
  "pnpm": {
    "overrides": {
      "react-native-reanimated": "3.16.1"
    }
  }
}

// packages/app/package.json
{
  "dependencies": {
    "react-native-reanimated": "3.16.1"
  }
}

// packages/ui/package.json
{
  "dependencies": {
    "react-native-reanimated": "3.16.1"
  }
}
```

Use your package manager's override/resolution feature to enforce versions at
the root. When adding dependencies, specify exact versions without `^` or `~`.
