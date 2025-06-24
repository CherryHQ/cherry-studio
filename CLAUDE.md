---
description: 
globs: 
alwaysApply: true
---
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CherryStudio Overview

CherryStudio is a cross-platform Electron desktop application that provides a powerful AI assistant interface supporting multiple LLM providers. The project uses a modern tech stack with TypeScript, React, Redux Toolkit, and Vite.

## Development Commands

### Running the Application
- `yarn dev`: Start development server with hot reload
- `yarn dev:safe`: Check port availability before starting (recommended)
- `yarn debug`: Start with debugging enabled for troubleshooting

### Building
- `yarn build`: Build for current platform
- `yarn build:win`: Build for Windows (both x64 and arm64)
- `yarn build:mac`: Build for macOS (both x64 and arm64)
- `yarn build:linux`: Build for Linux platforms

### Testing
- `yarn test`: Run all tests (main + renderer)
- `yarn test:main`: Test main process only
- `yarn test:renderer`: Test renderer process only
- `yarn test:coverage`: Generate test coverage report
- `yarn test:e2e`: Run Playwright end-to-end tests
- `yarn test:watch`: Run tests in watch mode for TDD

### Code Quality
- `yarn lint`: Run ESLint checks
- `yarn format`: Format code with Prettier
- `yarn typecheck`: Run TypeScript type checking
- `yarn check:i18n`: Validate internationalization
- `yarn analyze:renderer`: Analyze bundle size

## High-Level Architecture

### Multi-Process Architecture
CherryStudio follows Electron's multi-process architecture:

1. **Main Process** (`src/main/`): Node.js environment handling OS integration
   - `index.ts`: Application entry point, window management, IPC setup
   - `services/`: Core services (WindowService, MCPService, StorageService)
   - `embeddings/`: Text embedding implementations for AI features
   - `reranker/`: Document reranking functionality
   - `mcpServers/`: MCP (Model Context Protocol) server implementations

2. **Renderer Process** (`src/renderer/`): React application
   - `aiCore/`: AI provider integrations (OpenAI, Anthropic, Google, etc.)
   - `pages/`: Main application pages (Home, Chat, Settings)
   - `store/`: Redux store with slices for state management
   - `services/`: Frontend services for API communication

3. **Preload Scripts** (`src/preload/`): Secure bridge between processes
   - Exposes safe APIs to renderer via `window.api`
   - Handles IPC communication security

### Key Architectural Patterns

1. **Window Management**: Multiple window types (main, mini, selection toolbar)
   - WindowService handles creation, positioning, and lifecycle
   - Each window type has dedicated HTML entry point

2. **AI Integration Layer**:
   - Unified client interface for multiple LLM providers
   - Middleware system for response processing
   - Web search and knowledge base integration

3. **Storage Architecture**:
   - Local file storage with optional encryption
   - WebDAV support for remote synchronization
   - Separate stores for configuration, sessions, and knowledge bases

4. **State Management**:
   - Redux Toolkit for global state
   - React hooks for local component state
   - IPC for cross-process state synchronization

### Path Aliases
The project uses TypeScript path aliases for cleaner imports:
- `@main/*`: Main process modules
- `@renderer/*`: Renderer process modules  
- `@shared/*`: Shared types and utilities

### Testing Strategy
- **Unit Tests**: Vitest with separate configurations for main/renderer
- **E2E Tests**: Playwright for user workflow testing
- **Test Location**: Tests co-located with source files as `*.test.ts(x)`

### Development Workflow

1. **Feature Development**:
   - Create feature branch from main
   - Run `yarn dev:safe` for development
   - Use `yarn test:watch` for TDD approach
   - Ensure `yarn typecheck` passes before commit

2. **Cross-Process Communication**:
   - Define IPC channels in main process
   - Expose safe methods via preload
   - Use type-safe IPC handlers

3. **AI Provider Integration**:
   - Implement provider client in `aiCore/`
   - Add middleware if needed for response processing
   - Update provider configuration in settings

4. **Multi-Window Features**:
   - Define window configuration in WindowService
   - Create dedicated HTML entry if needed
   - Handle window-specific IPC channels

### Current Development Focus
- Selection Assistant feature
- Deep Research capabilities
- Memory System implementation
- Plugin system architecture
- Voice features (ASR/TTS integration)

## Project Configuration Files

- `electron.vite.config.ts`: Build configuration for all processes
- `tsconfig.*.json`: TypeScript configurations (node/web environments)
- `.eslintrc.cjs`: ESLint rules with TypeScript and React plugins
- `electron-builder.json5`: Platform-specific build configurations
- `playwright.config.ts`: E2E test configuration