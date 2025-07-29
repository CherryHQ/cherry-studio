# AI Agent Feature Implementation Tasks

**Feature**: AI Agent System for Cherry Studio
**Version**: 1.0
**Date**: July 29, 2025
**Status**: Ready for Implementation

## Overview
This document provides a comprehensive task breakdown following Test-Driven Development methodology. Tasks are organized by implementation phases with clear dependencies and acceptance criteria.

---

## Task 1: Database Schema and Migrations

### Description
Implement the database schema for agents, sessions, and session_logs tables with proper indexing and constraints.

### Acceptance Criteria (EARS-based)
- The system SHALL create three new tables: agents, sessions, and session_logs
- WHEN the migration runs THEN all foreign key constraints SHALL be properly established
- The system SHALL enforce unique constraint on agent names
- WHEN inserting invalid data THEN the system SHALL reject with appropriate error messages

### TDD Implementation Steps
1. **Red Phase**: Write tests for database schema validation and constraint enforcement
2. **Green Phase**: Implement migration scripts and database service methods
3. **Refactor Phase**: Optimize queries and add proper indexing

### Test Scenarios
- **Unit tests**:
  - Schema creation and validation
  - Constraint enforcement (unique names, required fields)
  - Foreign key relationships
- **Integration tests**:
  - Migration rollback scenarios
  - Data integrity during concurrent operations
- **Edge cases**:
  - Invalid JSON data in tools/knowledges fields
  - SQL injection prevention
  - Maximum field length validation

### Dependencies
- Requires: Existing LibSQL database connection
- Blocks: All other database-dependent tasks

### Files to Create/Modify
- `src/main/services/agents/database/migrations/001_create_agent_tables.sql`
- `src/main/services/agents/database/schema.ts`
- `src/main/services/agents/AgentDatabaseService.ts`

---

## Task 2: Agent Data Models and Validation

### Description
Create TypeScript interfaces and validation schemas for Agent, Session, and SessionLog entities.

### Acceptance Criteria (EARS-based)
- The system SHALL define strict TypeScript interfaces for all agent-related data structures
- WHEN validating agent configuration THEN the system SHALL enforce all field constraints
- The system SHALL sanitize all user inputs before persistence
- WHEN tools or knowledges are invalid THEN the system SHALL return specific validation errors

### TDD Implementation Steps
1. **Red Phase**: Write tests for data validation, sanitization, and type checking
2. **Green Phase**: Implement interfaces, validation functions, and sanitization logic
3. **Refactor Phase**: Create reusable validation utilities and improve error messages

### Test Scenarios
- **Unit tests**:
  - Interface type checking
  - Field validation (length, format, required fields)
  - JSON schema validation for tools/knowledges
- **Integration tests**:
  - Validation error handling in service layer
  - Database constraint interaction
- **Edge cases**:
  - Unicode characters in names/descriptions
  - Extremely long system prompts
  - Invalid model IDs

### Dependencies
- Requires: Task 1 (Database Schema)
- Blocks: Task 3 (Agent Service Layer)

### Files to Create/Modify
- `src/renderer/src/types/agent.ts`
<!-- - `src/renderer/src/validation/agentValidation.ts`
- `src/renderer/src/utils/sanitization.ts` -->

---

## Task 3: Agent Service Layer (Main Process)

### Description
Implement the core agent service for CRUD operations and business logic in the main process.

### Acceptance Criteria (EARS-based)
- The system SHALL provide methods for creating, reading, updating, and deleting agents
- WHEN an agent is created THEN the system SHALL validate all fields and persist to database
- The system SHALL prevent deletion of agents with active sessions
- WHEN duplicate agent names are provided THEN the system SHALL return a specific error

### TDD Implementation Steps
1. **Red Phase**: Write tests for all CRUD operations and business rules
2. **Green Phase**: Implement AgentService class with database operations
3. **Refactor Phase**: Add caching, error handling, and performance optimizations

### Test Scenarios
- **Unit tests**:
  - CRUD operation success paths
  - Business rule enforcement
  - Error handling and validation
- **Integration tests**:
  - Database transaction handling
  - Concurrent operation safety
- **Edge cases**:
  - Database connection failures
  - Invalid foreign key references
  - Resource limit violations

### Dependencies
- Requires: Task 1 (Database Schema), Task 2 (Data Models)
- Blocks: Task 5 (IPC Communication)

### Files to Create/Modify
- `src/main/services/agents/index.ts`
- `src/main/services/agents/__tests__/index.test.ts`

---

## Task 4: Process Management System

### Description
Implement the Python child process management system with streaming IPC communication.

### Acceptance Criteria (EARS-based)
- The system SHALL spawn Python child processes with proper stdio pipe configuration
- WHEN a process crashes THEN the system SHALL clean up resources and update session status
- The system SHALL handle streaming JSON messages with buffer management
- WHEN stopping an agent THEN the system SHALL terminate the process within 5 seconds

### TDD Implementation Steps
1. **Red Phase**: Write tests for process lifecycle, IPC communication, and error handling
2. **Green Phase**: Implement AgentProcessManager with streaming support
3. **Refactor Phase**: Add resource monitoring, cleanup procedures, and performance optimizations

### Test Scenarios
- **Unit tests**:
  - Process spawning and termination
  - IPC message parsing and validation
  - Stream buffer management
- **Integration tests**:
  - End-to-end process communication
  - Error recovery scenarios
- **Edge cases**:
  - Malformed JSON messages
  - Process timeout scenarios
  - Resource exhaustion handling

### Dependencies
- Requires: Task 2 (Data Models)
- Blocks: Task 6 (Session Management)

### Files to Create/Modify
- `src/main/services/agents/processManager.ts`
- `src/main/types/ipc.ts`
- `src/main/services/agents/__tests__/processManager.test.ts`

---

## Task 5: IPC Communication Protocol

### Description
Implement the streaming IPC protocol for communication between main process and Python agents.

### Acceptance Criteria (EARS-based)
- The system SHALL define a standard message format for all IPC communications
- WHEN receiving streaming messages THEN the system SHALL forward content to UI within 100ms
- The system SHALL validate all incoming messages before processing
- WHEN IPC errors occur THEN the system SHALL log details and attempt graceful recovery

### TDD Implementation Steps
1. **Red Phase**: Write tests for message serialization, validation, and streaming
2. **Green Phase**: Implement IPC message handlers and streaming protocol
3. **Refactor Phase**: Optimize message throughput and add compression

### Test Scenarios
- **Unit tests**:
  - Message serialization/deserialization
  - Validation of message format
  - Stream processing logic
- **Integration tests**:
  - Message flow between processes
  - Error propagation and recovery
- **Edge cases**:
  - Large message handling
  - Network-like delays in IPC
  - Partial message corruption

### Dependencies
- Requires: Task 4 (Process Management)
- Blocks: Task 7 (UI Components)

### Files to Create/Modify
- `src/main/ipc/AgentIPCHandler.ts`
- `src/main/ipc/messageValidation.ts`
- `src/preload/agentIPC.ts`

---

## Task 6: Session Management

### Description
Implement session lifecycle management including creation, monitoring, and persistence.

### Acceptance Criteria (EARS-based)
- The system SHALL create a new session record when agent execution starts
- WHEN session logs are received THEN the system SHALL persist them to database immediately
- The system SHALL update session status in real-time during execution
- WHEN sessions exceed resource limits THEN the system SHALL terminate and update status

### TDD Implementation Steps
1. **Red Phase**: Write tests for session CRUD, logging, and status management
2. **Green Phase**: Implement SessionService with real-time updates
3. **Refactor Phase**: Add pagination, archival, and performance optimizations

### Test Scenarios
- **Unit tests**:
  - Session creation and status updates
  - Log entry persistence
  - Resource limit enforcement
- **Integration tests**:
  - Session-process lifecycle coordination
  - Database transaction consistency
- **Edge cases**:
  - Concurrent session operations
  - Large log volume handling
  - Database storage limits

### Dependencies
- Requires: Task 3 (Agent Service), Task 4 (Process Management)
- Blocks: Task 8 (Agent Hub UI)

### Files to Create/Modify
- `src/main/services/agents/SessionService.ts`
- `src/main/services/agents/__tests__/SessionService.test.ts`

---

## Task 7: Agent Hub Page Layout

### Description
Create the main Agent Hub page with two-column layout and basic navigation structure.

### Acceptance Criteria (EARS-based)
- The system SHALL display a two-column layout with agent list on left and details on right
- WHEN no agents exist THEN the system SHALL show an empty state with create button
- The system SHALL provide navigation to agent configuration and execution views
- The system SHALL load agent list within 1 second for up to 100 agents

### TDD Implementation Steps
1. **Red Phase**: Write tests for component rendering, layout, and navigation
2. **Green Phase**: Implement React components with basic styling
3. **Refactor Phase**: Add responsive design, loading states, and accessibility

### Test Scenarios
- **Unit tests**:
  - Component rendering with different states
  - Navigation behavior
  - Empty state display
- **Integration tests**:
  - Data loading and display
  - User interaction flows
- **Edge cases**:
  - Very long agent names
  - Large number of agents
  - Loading error states

### Dependencies
- Requires: Task 5 (IPC Communication)
- Blocks: Task 9 (Agent Configuration UI)

### Files to Create/Modify
- `src/renderer/src/pages/AgentHub/AgentHubPage.tsx`
- `src/renderer/src/components/AgentList/AgentList.tsx`
- `src/renderer/src/styles/agentHub.css`

---

## Task 8: Agent List Component

### Description
Implement the agent list component with search, filtering, and selection functionality.

### Acceptance Criteria (EARS-based)
- The system SHALL display all agents with name, description, and status
- WHEN user types in search THEN the system SHALL filter results in real-time
- The system SHALL highlight the currently selected agent
- WHEN clicking "+ New Agent" THEN the system SHALL show template selection dialog

### TDD Implementation Steps
1. **Red Phase**: Write tests for list rendering, search, and interactions
2. **Green Phase**: Implement component with search and selection logic
3. **Refactor Phase**: Add virtualization for large lists and improve performance

### Test Scenarios
- **Unit tests**:
  - List rendering with mock data
  - Search functionality
  - Selection state management
- **Integration tests**:
  - Data loading from main process
  - Template selection flow
- **Edge cases**:
  - Empty search results
  - Special characters in search
  - Rapid search input changes

### Dependencies
- Requires: Task 7 (Agent Hub Layout)
- Blocks: Task 10 (Template System)

### Files to Create/Modify
- `src/renderer/src/components/AgentList/AgentListItem.tsx`
- `src/renderer/src/components/AgentList/AgentSearch.tsx`
- `src/renderer/src/hooks/useAgentSearch.ts`

---

## Task 9: Agent Configuration Form

### Description
Create the agent configuration form with validation, tool selection, and knowledge base integration.

### Acceptance Criteria (EARS-based)
- The system SHALL provide form fields for all agent configuration options
- WHEN user enters invalid data THEN the system SHALL show field-specific error messages
- The system SHALL validate agent names for uniqueness before saving
- WHEN saving fails THEN the system SHALL preserve user input and show error details

### TDD Implementation Steps
1. **Red Phase**: Write tests for form validation, submission, and error handling
2. **Green Phase**: Implement form components with validation logic
3. **Refactor Phase**: Add auto-save, form state persistence, and UX improvements

### Test Scenarios
- **Unit tests**:
  - Form field validation
  - Error message display
  - Submit/cancel behavior
- **Integration tests**:
  - Data persistence to main process
  - Tool and knowledge selection
- **Edge cases**:
  - Network failures during save
  - Very long system prompts
  - Invalid model selections

### Dependencies
- Requires: Task 8 (Agent List)
- Blocks: Task 11 (Execution Panel)

### Files to Create/Modify
- `src/renderer/src/components/AgentConfig/AgentConfigForm.tsx`
- `src/renderer/src/components/AgentConfig/ToolSelector.tsx`
- `src/renderer/src/components/AgentConfig/KnowledgeSelector.tsx`

---

## Task 10: Agent Template System

### Description
Implement pre-configured agent templates (Code Documenter, Unit Test Generator, PRD Reviewer).

### Acceptance Criteria (EARS-based)
- The system SHALL provide three predefined agent templates
- WHEN user selects a template THEN the system SHALL pre-populate configuration fields
- The system SHALL allow users to modify template configurations before saving
- WHEN templates are updated THEN existing agents created from templates SHALL remain unchanged

### TDD Implementation Steps
1. **Red Phase**: Write tests for template data structure, selection, and application
2. **Green Phase**: Implement template definitions and selection UI
3. **Refactor Phase**: Add template versioning and customization options

### Test Scenarios
- **Unit tests**:
  - Template data validation
  - Configuration pre-population
  - Template selection UI
- **Integration tests**:
  - Agent creation from templates
  - Template modification flow
- **Edge cases**:
  - Invalid template data
  - Template conflicts with existing agents
  - Missing tool/knowledge dependencies

### Dependencies
- Requires: Task 9 (Agent Configuration)
- Blocks: Task 12 (Redux Integration)

### Files to Create/Modify
- `src/renderer/src/data/agentTemplates.ts`
- `src/renderer/src/components/AgentConfig/TemplateSelector.tsx`
- `src/renderer/src/types/agentTemplate.ts`

---

## Task 11: Execution Panel UI

### Description
Create the agent execution panel with real-time log display and control buttons.

### Acceptance Criteria (EARS-based)
- The system SHALL display real-time execution logs with color-coded message types
- WHEN execution starts THEN the system SHALL show progress indicator and disable start button
- The system SHALL provide a prominent stop button that remains enabled during execution
- WHEN logs exceed display limit THEN the system SHALL implement auto-scrolling with scroll lock option

### TDD Implementation Steps
1. **Red Phase**: Write tests for log display, streaming updates, and control interactions
2. **Green Phase**: Implement execution panel with real-time updates
3. **Refactor Phase**: Add log export, search, and performance optimizations

### Test Scenarios
- **Unit tests**:
  - Log message rendering
  - Control button states
  - Auto-scrolling behavior
- **Integration tests**:
  - Real-time log streaming
  - Execution control flow
- **Edge cases**:
  - Very rapid log updates
  - Large log messages
  - Execution interruption scenarios

### Dependencies
- Requires: Task 10 (Template System)
- Blocks: Task 13 (Error Handling UI)

### Files to Create/Modify
- `src/renderer/src/components/ExecutionPanel/ExecutionPanel.tsx`
- `src/renderer/src/components/ExecutionPanel/LogViewer.tsx`
- `src/renderer/src/components/ExecutionPanel/ExecutionControls.tsx`

---

## Task 12: Redux Store Integration

### Description
Integrate agent management with Redux store for state management and persistence.

### Acceptance Criteria (EARS-based)
- The system SHALL manage agent, session, and execution state in Redux store
- WHEN data changes in main process THEN the system SHALL synchronize with Redux store
- The system SHALL persist critical state across application restarts
- WHEN concurrent updates occur THEN the system SHALL handle conflicts gracefully

### TDD Implementation Steps
1. **Red Phase**: Write tests for actions, reducers, and state synchronization
2. **Green Phase**: Implement Redux slices and synchronization logic
3. **Refactor Phase**: Add optimistic updates, caching, and conflict resolution

### Test Scenarios
- **Unit tests**:
  - Action creators and reducers
  - State serialization/deserialization
  - Middleware functionality
- **Integration tests**:
  - Main process synchronization
  - State persistence and recovery
- **Edge cases**:
  - State corruption scenarios
  - Large state objects
  - Synchronization failures

### Dependencies
- Requires: Task 11 (Execution Panel)
- Blocks: Task 14 (Session History)

### Files to Create/Modify
- `src/renderer/src/store/slices/agentSlice.ts`
- `src/renderer/src/store/slices/sessionSlice.ts`
- `src/renderer/src/store/middleware/agentSync.ts`

---

## Task 13: Error Handling and User Feedback

### Description
Implement comprehensive error handling with user-friendly error messages and recovery options.

### Acceptance Criteria (EARS-based)
- The system SHALL display specific error messages for different failure scenarios
- WHEN errors occur THEN the system SHALL provide actionable recovery suggestions
- The system SHALL log errors for debugging while showing sanitized messages to users
- WHEN network issues occur THEN the system SHALL provide retry mechanisms

### TDD Implementation Steps
1. **Red Phase**: Write tests for error scenarios, message display, and recovery flows
2. **Green Phase**: Implement error handling components and utilities
3. **Refactor Phase**: Add error analytics and improved user guidance

### Test Scenarios
- **Unit tests**:
  - Error message formatting
  - Recovery action handling
  - Error boundary behavior
- **Integration tests**:
  - End-to-end error flows
  - Error logging and reporting
- **Edge cases**:
  - Nested error scenarios
  - Error handling during error handling
  - Resource exhaustion errors

### Dependencies
- Requires: Task 12 (Redux Integration)
- Blocks: Task 15 (Performance Optimization)

### Files to Create/Modify
- `src/renderer/src/components/ErrorBoundary/ErrorBoundary.tsx`
- `src/renderer/src/utils/errorHandling.ts`
- `src/renderer/src/components/ErrorDisplay/ErrorDisplay.tsx`

---

## Task 14: Session History and Management

### Description
Implement session history display with filtering, search, and detailed log viewing.

### Acceptance Criteria (EARS-based)
- The system SHALL display a list of recent sessions with metadata and status
- WHEN user clicks on a session THEN the system SHALL show complete execution log
- The system SHALL provide filtering by agent, status, and date range
- WHEN sessions exceed display limit THEN the system SHALL implement pagination

### TDD Implementation Steps
1. **Red Phase**: Write tests for history display, filtering, and log viewing
2. **Green Phase**: Implement session history components and navigation
3. **Refactor Phase**: Add export functionality and performance optimizations

### Test Scenarios
- **Unit tests**:
  - Session list rendering
  - Filter and search logic
  - Pagination behavior
- **Integration tests**:
  - Data loading and display
  - Log detail navigation
- **Edge cases**:
  - Large session histories
  - Corrupted session data
  - Missing log entries

### Dependencies
- Requires: Task 13 (Error Handling)
- Blocks: Task 16 (Testing Suite)

### Files to Create/Modify
- `src/renderer/src/components/SessionHistory/SessionHistory.tsx`
- `src/renderer/src/components/SessionHistory/SessionFilter.tsx`
- `src/renderer/src/components/SessionHistory/SessionDetail.tsx`

---

## Task 15: Performance Optimization

### Description
Implement performance optimizations for large datasets, streaming, and UI responsiveness.

### Acceptance Criteria (EARS-based)
- The system SHALL maintain UI responsiveness during high-frequency log updates
- WHEN agent lists exceed 50 items THEN the system SHALL implement virtualization
- The system SHALL limit memory usage for long-running sessions
- WHEN database queries are slow THEN the system SHALL implement proper caching

### TDD Implementation Steps
1. **Red Phase**: Write performance tests and benchmarks for critical paths
2. **Green Phase**: Implement optimizations including virtualization and caching
3. **Refactor Phase**: Add monitoring and adaptive performance tuning

### Test Scenarios
- **Unit tests**:
  - Performance benchmarks
  - Memory usage validation
  - Cache effectiveness
- **Integration tests**:
  - End-to-end performance scenarios
  - Load testing with large datasets
- **Edge cases**:
  - Memory pressure scenarios
  - Slow network conditions
  - Resource contention

### Dependencies
- Requires: Task 14 (Session History)
- Blocks: Task 17 (Security Audit)

### Files to Create/Modify
- `src/renderer/src/hooks/useVirtualization.ts`
- `src/renderer/src/utils/performanceMonitoring.ts`
- `src/main/services/CacheService.ts`

---

## Task 16: Comprehensive Testing Suite

### Description
Implement comprehensive test coverage including unit, integration, and end-to-end tests.

### Acceptance Criteria (EARS-based)
- The system SHALL maintain 90%+ test coverage for all critical components
- WHEN tests run THEN they SHALL complete within 5 minutes for the full suite
- The system SHALL include both positive and negative test scenarios
- WHEN CI/CD runs THEN all tests SHALL pass before deployment

### TDD Implementation Steps
1. **Red Phase**: Identify coverage gaps and write missing tests
2. **Green Phase**: Implement comprehensive test suites
3. **Refactor Phase**: Optimize test performance and reliability

### Test Scenarios
- **Unit tests**:
  - All service methods and utilities
  - Component rendering and interactions
  - Data validation and sanitization
- **Integration tests**:
  - Main process ↔ Renderer communication
  - Database operations
  - IPC message flows
- **E2E tests**:
  - Complete user workflows
  - Error recovery scenarios
  - Performance under load

### Dependencies
- Requires: Task 15 (Performance Optimization)
- Blocks: Task 17 (Security Audit)

### Files to Create/Modify
- `src/main/**/__tests__/*.test.ts`
- `src/renderer/**/__tests__/*.test.tsx`
- `tests/e2e/agent-workflows.spec.ts`

---

## Task 17: Security Audit and Hardening

### Description
Conduct security audit and implement hardening measures for agent execution and data protection.

### Acceptance Criteria (EARS-based)
- The system SHALL validate and sanitize all user inputs before processing
- WHEN displaying execution logs THEN the system SHALL prevent XSS attacks
- The system SHALL encrypt sensitive data at rest in the database
- WHEN agents access files THEN the system SHALL enforce workspace sandbox restrictions

### TDD Implementation Steps
1. **Red Phase**: Write security tests for input validation, XSS prevention, and sandbox enforcement
2. **Green Phase**: Implement security measures and validation
3. **Refactor Phase**: Add security monitoring and threat detection

### Test Scenarios
- **Unit tests**:
  - Input sanitization functions
  - XSS prevention measures
  - Data encryption/decryption
- **Integration tests**:
  - End-to-end security flows
  - Sandbox boundary enforcement
- **Security tests**:
  - Penetration testing scenarios
  - Vulnerability scanning
  - Social engineering resistance

### Dependencies
- Requires: Task 16 (Testing Suite)
- Blocks: Task 18 (Documentation)

### Files to Create/Modify
- `src/main/security/inputSanitization.ts`
- `src/main/security/sandboxEnforcement.ts`
- `src/renderer/src/utils/xssProtection.ts`

---

## Task 18: Documentation and Deployment

### Description
Create comprehensive documentation and prepare for production deployment.

### Acceptance Criteria (EARS-based)
- The system SHALL include user documentation for all features
- WHEN developers onboard THEN the system SHALL provide technical documentation
- The system SHALL include deployment guides and troubleshooting information
- WHEN features are updated THEN documentation SHALL be updated accordingly

### TDD Implementation Steps
1. **Red Phase**: Write tests for documentation completeness and accuracy
2. **Green Phase**: Create comprehensive documentation suite
3. **Refactor Phase**: Add interactive examples and improve organization

### Test Scenarios
- **Documentation tests**:
  - Link validation and accuracy
  - Code example compilation
  - Walkthrough completeness
- **Integration tests**:
  - Documentation-code synchronization
  - Example execution validation
- **User acceptance tests**:
  - Documentation usability
  - Onboarding flow effectiveness

### Dependencies
- Requires: Task 17 (Security Audit)
- Blocks: None (Final task)

### Files to Create/Modify
- `docs/user-guide/ai-agents.md`
- `docs/technical/agent-architecture.md`
- `docs/deployment/ai-agent-setup.md`

---

## Implementation Summary

### Task Distribution
- **Infrastructure Tasks**: 1-6 (Database, Models, Services, IPC)
- **UI Tasks**: 7-11 (Components, Forms, Templates, Execution)
- **Integration Tasks**: 12-14 (Redux, Error Handling, History)
- **Quality Tasks**: 15-18 (Performance, Testing, Security, Documentation)

### Dependencies Overview
```
1 → 2 → 3 → 6 → 14 → 15 → 16 → 17 → 18
    ↓   ↓
    4 → 5 → 7 → 8 → 9 → 10 → 11 → 12 → 13
```

### Estimated Timeline
- **Week 1-2**: Tasks 1-6 (Infrastructure)
- **Week 3-4**: Tasks 7-11 (UI Components)
- **Week 5-6**: Tasks 12-14 (Integration & Features)
- **Week 7-8**: Tasks 15-18 (Quality & Launch)

### Success Criteria
- [ ] All 18 tasks completed with passing tests
- [ ] 90%+ test coverage achieved
- [ ] Performance targets met (< 1s load time, < 500ms updates)
- [ ] Security audit passed
- [ ] User acceptance testing completed

---

## Implementation Task Breakdown Complete

Created **18 comprehensive tasks** following TDD methodology, covering:

**Infrastructure**: Database schema, data models, services, process management, IPC communication, session management

**User Interface**: Agent Hub layout, agent list, configuration forms, templates, execution panel

**Integration**: Redux store, error handling, session history

**Quality Assurance**: Performance optimization, comprehensive testing, security audit, documentation

Tasks are sequenced with proper dependencies and include comprehensive test scenarios for Red-Green-Refactor cycles. Each task includes specific acceptance criteria based on EARS requirements and is estimated for 2-4 hour completion windows.

**Ready to begin implementation, or would you like to review and modify the task breakdown first?**
