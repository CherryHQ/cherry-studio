# 🖥️ Develop

## IDE Setup

### VSCode like

- Editor: [Cursor](https://www.cursor.com/), etc. Any VS Code compatible editor.
- Recommended extensions are listed in [`.vscode/extensions.json`](/.vscode/extensions.json).

### Zed

1. Install extensions: [Biome](https://github.com/biomejs/biome-zed), [oxc](https://github.com/oxc-project/zed-oxc)
2. Copy the example settings file to your local Zed config:
   ```bash
   cp .zed/settings.json.example .zed/settings.json
   ```
3. Customize `.zed/settings.json` as needed (it is git-ignored).

## Windows: Enable Symlinks

This project uses symlinks to synchronize files such as AGENTS.md and skills. Windows developers must enable symlink support before cloning:

1. **Enable Developer Mode** (Settings → Update & Security → For developers), or grant `SeCreateSymbolicLinkPrivilege` via `secpol.msc`.
2. **Configure Git**:
   ```bash
   git config --global core.symlinks true
   ```
3. Clone (or re-clone) the repository after enabling symlink support.

## Project Setup

### Install

```bash
pnpm install
```

### Development

### Setup Node.js

The required Node.js version is defined in `.node-version`. Use a version manager like [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to install it automatically:

```bash
nvm install
```

### Setup pnpm

The pnpm version is locked in the `packageManager` field of `package.json`. Just enable corepack and it will use the correct version automatically:

```bash
corepack enable
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
