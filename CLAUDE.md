# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development

```bash
yarn dev          # Start development server with hot reload
yarn debug        # Start with debugging enabled (inspect port 9222)
```

### Code Quality (run before committing)

```bash
yarn lint         # Run ESLint and fix issues
yarn typecheck    # Check TypeScript types for both processes
yarn test         # Run all tests
```

### Building

```bash
yarn build        # Build for production (all platforms)
yarn build:win    # Build for Windows
yarn build:mac    # Build for macOS
yarn build:linux  # Build for Linux
```

### Testing

```bash
yarn test                 # Run all tests
yarn test:watch          # Run tests in watch mode
yarn test:coverage       # Generate coverage report
yarn test:e2e            # Run Playwright E2E tests
```

## Architecture Overview

Cherry Studio is an Electron desktop application that provides a unified interface for multiple LLM providers.

### Core Structure

- **Main Process** (`src/main/`): Handles system operations, file management, WebDAV sync, and MCP servers
- **Renderer Process** (`src/renderer/`): React application with the user interface
- **Preload Scripts** (`src/preload/`): Bridge between main and renderer processes

### Key Architectural Components

1. **AI Core** (`src/renderer/src/aiCore/`): Implements adapters for different LLM providers (OpenAI, Anthropic, etc.)

2. **State Management**: Uses Redux Toolkit with slices for:

   - `assistants` - AI assistant configurations
   - `chats` - Conversation management
   - `runtime` - Application runtime state
   - `knowledge` - Knowledge base and embeddings

3. **Services** (`src/main/services/`):

   - `WebDAVService` - File sync and backup
   - `MCPService` - Model Context Protocol server management
   - `FileService` - Document processing and file operations

4. **IPC Communication**: Uses typed IPC channels defined in `src/main/preload.ts` for secure main-renderer communication

5. **Multi-Provider Support**: Each AI provider has its own client implementation in `aiCore/` with a common interface

### Technology Stack

- **Electron 35.4.0** with **React 19** and **TypeScript**
- **Vite** for fast development and building
- **Styled Components** for styling
- **Ant Design** for UI components
- **Redux Toolkit** for state management
- **Vitest** and **Playwright** for testing
