# Intent Lifecycle Storytelling

This document demonstrates the explicit lifecycle tracking and governance capabilities of the orchestration system.

## Lifecycle States

Intents progress through the following states:

1. **TODO** - Intent is defined but not yet started
2. **IN_PROGRESS** - Intent is actively being worked on (automatically set on first code change)
3. **DONE** - Intent is complete (set when task completes with activity)
4. **BLOCKED** - Intent is blocked by dependencies or issues

## Automatic Lifecycle Transitions

### Intent Creation
- When `create_intent` tool is called, intent is created with status `IN_PROGRESS`
- Intent is added to `active_intents.yaml` with metadata (created_at, updated_at)

### Intent Activation
- When `select_active_intent` is called, the intent context is loaded
- Recent trace entries are retrieved to provide context
- Intent status remains unchanged (preserves current state)

### Code Changes
- When a destructive tool (write_to_file, edit_file, etc.) is called:
  - If intent status is `TODO`, it's automatically updated to `IN_PROGRESS`
  - Trace entry is logged to `agent_trace.jsonl` with mutation_class
  - `intent_map.md` is updated with file mappings
  - Lifecycle event is recorded to `AGENT.md`

### Task Completion
- When `attempt_completion` is called:
  - System checks if intent has recent trace entries
  - If intent is `IN_PROGRESS` and has activity, status is updated to `DONE`
  - Lifecycle transition is recorded to `AGENT.md`

## Evidence of Lifecycle Storytelling

### 1. active_intents.yaml
Contains intent status, timestamps, and metadata showing evolution:
```yaml
active_intents:
  - id: INT-001
    name: Intent-Code Traceability
    status: IN_PROGRESS  # Shows current state
    created_at: 2026-02-18T08:56:57.063Z
    updated_at: 2026-02-21T15:50:14.000Z  # Shows last activity
```

### 2. agent_trace.jsonl
Append-only ledger showing intent-to-code mappings:
```json
{
  "id": "trace-...",
  "timestamp": "2026-02-21T15:50:14Z",
  "files": [{
    "relative_path": "src/hooks/HookEngine.ts",
    "conversations": [{
      "ranges": [{
        "content_hash": "sha256:..."
      }],
      "related": [{
        "type": "intent",
        "value": "INT-001"
      }]
    }]
  }],
  "mutation_class": "INTENT_EVOLUTION"  # Shows type of change
}
```

### 3. intent_map.md
Maps intents to physical files, showing explicit file ownership:
```markdown
## INT-001: Intent-Code Traceability
- **Status:** IN_PROGRESS
- **Last Updated:** 2026-02-21T15:50:14Z
### Files
  - `src/hooks/HookEngine.ts` (updated 2026-02-21T15:50:14Z)
```

### 4. AGENT.md
Shared brain containing lifecycle events and lessons:
```markdown
## Intent Lifecycle Events
### 2026-02-21: Intent Lifecycle Transition
- **Intent:** INT-001
- **Transition:** TODO → IN_PROGRESS
- **Timestamp:** 2026-02-21T15:50:14Z
```

## Parallel Orchestration Evidence

The system demonstrates parallel orchestration through:

1. **Optimistic Locking**: File hash cache prevents collisions
2. **Shared Brain (AGENT.md)**: Lessons learned are shared across sessions
3. **Intent Scope Isolation**: Each intent owns specific file paths
4. **Lifecycle Coordination**: Status updates prevent duplicate work

## Governance and Auditability

Every lifecycle transition is:
- **Timestamped**: ISO 8601 timestamps in all artifacts
- **Traceable**: Linked via intent_id across all files
- **Auditable**: Append-only trace ledger prevents tampering
- **Documented**: AGENT.md provides human-readable context

