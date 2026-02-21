# Shared Knowledge Base

This file contains persistent knowledge shared across parallel sessions (Architect/Builder/Tester). This is the "Shared Brain" that enables parallel orchestration by maintaining context, lessons learned, and lifecycle events across multiple agent instances.

## Lessons Learned

### 2026-02-21: Hook Engine Singleton Pattern
- **Issue:** Initial implementation created new HookEngine instance per tool call, causing fileHashCache to reset
- **Solution:** Implemented singleton pattern per Task instance, attaching HookEngine to task object
- **Impact:** Enables optimistic locking and stale file detection across tool calls
- **Related Intent:** INT-002
- **Category:** architecture

### 2026-02-21: Post-Hook Trace Logging
- **Issue:** Trace entries were not being logged for all destructive tools
- **Solution:** Wired postHook for all destructive tools (apply_diff, apply_patch, edit, search_replace)
- **Impact:** Complete traceability coverage for all code modification operations
- **Related Intent:** INT-005
- **Category:** bug_fix

### 2026-02-21: Intent Parameter Registration
- **Issue:** NativeToolCallParser rejected intent_id parameter for select_active_intent tool
- **Solution:** Added intent_id, lesson, category to toolParamNames and parser switch cases
- **Impact:** Orchestration tools now work correctly with native protocol
- **Related Intent:** INT-001
- **Category:** bug_fix

## Project-Specific Rules

### Code Style
- Always use async/await, never raw Promises
- Prefer named exports over default exports
- Use TypeScript strict mode
- HookEngine must be singleton per Task to maintain state

### Orchestration Patterns
- Always call select_active_intent before destructive tools
- Use record_lesson when verification steps fail
- Intent lifecycle: TODO → IN_PROGRESS → DONE (tracked automatically)

## Architectural Decisions

### 2026-02-21: Optimistic Locking Implementation
- **Decision:** Implement file hash caching for parallel orchestration
- **Rationale:** Prevents parallel agent collisions and data corruption
- **Impact:** Agents can work in parallel safely, stale file detection blocks overwrites
- **Related Intent:** INT-004
- **Status:** Implemented

### 2026-02-21: Mutation Classification
- **Decision:** Distinguish AST_REFACTOR vs INTENT_EVOLUTION using content similarity
- **Rationale:** Enables mathematical distinction between refactors and new features
- **Impact:** Trace entries now include mutation_class for better auditability
- **Related Intent:** INT-005
- **Status:** Implemented

## Intent Lifecycle Events

### 2026-02-21: Intent Lifecycle Tracking
- **System:** Automatic lifecycle updates when intents are used
- **Flow:** TODO → IN_PROGRESS (on first code change) → DONE (on task completion)
- **Evidence:** See active_intents.yaml for status transitions
- **Purpose:** Explicit lifecycle storytelling for governance and auditability

