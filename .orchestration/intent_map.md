# Intent Map

This file maps high-level business intents to physical files and AST nodes. When a manager asks, "Where is the billing logic?", this file provides the answer.

**Lifecycle Storytelling**: This file is automatically updated when code changes occur under an active intent, providing explicit evidence of intent-to-code mappings.

## Intents

## INT-001: Intent-Code Traceability (Spec)
- **Status:** IN_PROGRESS
- **Last Updated:** 2026-02-21T15:50:14Z
### Files
  - `src/hooks/HookEngine.ts` (updated 2026-02-21T15:50:14Z)
  - `src/hooks/OrchestrationDataModel.ts` (updated 2026-02-21T15:50:14Z)
  - `src/core/assistant-message/presentAssistantMessage.ts` (updated 2026-02-21T15:50:14Z)
### Scope
  - src/core/assistant-message/**
  - src/core/tools/**
  - src/core/hooks/**
  - src/core/orchestration/**
  - src/core/prompts/**
  - .orchestration/**

## INT-002: Hook System Implementation
- **Status:** IN_PROGRESS
- **Last Updated:** 2026-02-21T15:50:14Z
### Files
  - `src/hooks/HookEngine.ts` (updated 2026-02-21T15:50:14Z)
  - `src/core/assistant-message/presentAssistantMessage.ts` (updated 2026-02-21T15:50:14Z)
### Scope
  - src/core/hooks/**
  - src/core/assistant-message/presentAssistantMessage.ts
  - src/core/tools/**
  - .orchestration/**

