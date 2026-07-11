---
'@cherrystudio/ai-core': patch
---

Replace the misdeclared `biome@^0.3.3` devDependency — an unrelated legacy BDD test framework that dragged `lodash` 3.x/4.x (via `inquirer`/`request-promise`) into the dependency tree — with the intended `@biomejs/biome` CLI that the package's `format` scripts actually invoke.
