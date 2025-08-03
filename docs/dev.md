# 🖥️ Develop

## IDE Setup

[Cursor](https://www.cursor.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
yarn
```

### Development

### Setup Node.js

Download and install [Node.js v20.x.x](https://nodejs.org/en/download)

### Setup Yarn

```bash
corepack enable
corepack prepare yarn@4.6.0 --activate
```

### Install Dependencies

```bash
yarn install
```

### ENV

```bash
copy .env.example .env
```

### Start

```bash
yarn dev
```

### Debug

```bash
yarn debug
```

Then input chrome://inspect in browser

### Test

```bash
yarn test
```

### Build

```bash
# For windows
$ yarn build:win

# For macOS
$ yarn build:mac

# For Linux
$ yarn build:linux
```
