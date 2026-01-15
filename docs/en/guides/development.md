# 🖥️ Develop

## IDE Setup

- Editor: [Cursor](https://www.cursor.com/), etc. Any VS Code compatible editor.
- Linter: [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- Formatter: [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

## Project Setup

### Install

```bash
pnpm install
```

### Development

### Setup Node.js

Download and install [Node.js v22.x.x](https://nodejs.org/en/download)

### Setup pnpm

```bash
corepack enable
corepack prepare pnpm@10.27.0 --activate
```

### Install Dependencies

```bash
pnpm install
```

### ENV

```bash
cp .env.example .env
```

### Start

```bash
pnpm dev
```

### Debug

```bash
pnpm debug
```

Then input chrome://inspect in browser

### Test

```bash
pnpm test
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```
