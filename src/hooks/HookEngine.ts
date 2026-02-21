import { Task } from "../core/task/Task"
import type { ToolUse } from "../shared/tools"
import type { ToolName } from "@roo-code/types"
import { OrchestrationDataModel, type ActiveIntent } from "./OrchestrationDataModel"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { execSync } from "child_process"

/**
 * Hook execution result
 */
export interface HookResult {
	shouldProceed: boolean
	errorMessage?: string
	injectedContext?: string
}

/**
 * Hook Engine - Middleware boundary for tool execution
 * Implements Pre-Hook and Post-Hook interception
 */
export class HookEngine {
	private dataModel: OrchestrationDataModel
	// Track file hashes for optimistic locking (Phase 4: Parallel Orchestration)
	private fileHashCache: Map<string, string> = new Map()

	constructor(workspaceRoot: string) {
		this.dataModel = new OrchestrationDataModel(workspaceRoot)
	}

	/**
	 * UI-blocking authorization (HITL): pause execution until the user approves/rejects.
	 *
	 * We intentionally make this a modal dialog to "pause the Promise chain" as required by `document.md`.
	 * To avoid excessive prompts, we authorize once per intent per task session.
	 */
	private async ensureIntentAuthorized(
		task: Task,
		intent: ActiveIntent,
		toolName: ToolName,
		details?: { filePath?: string; command?: string },
	): Promise<{ approved: boolean; message?: string }> {
		const approvedSetKey = "__approvedIntentIds" as const
		const approved = ((task as any)[approvedSetKey] ?? []) as string[]

		// Authorize once per intent per task session.
		if (approved.includes(intent.id)) {
			return { approved: true }
		}

		const detailLines: string[] = []
		if (details?.filePath) detailLines.push(`File: ${details.filePath}`)
		if (details?.command) detailLines.push(`Command: ${details.command}`)
		if (detailLines.length === 0) detailLines.push(`Tool: ${toolName}`)

		const message =
			`Approve intent evolution for this task?\n\n` +
			`Intent: ${intent.id} — ${intent.name}\n` +
			detailLines.join("\n") +
			`\n\nThis will allow destructive actions under this intent for the current task session.`

		const answer = await vscode.window.showWarningMessage(message, { modal: true }, "Approve", "Reject")

		if (answer !== "Approve") {
			return { approved: false, message: "User rejected the intent evolution request." }
		}

		;(task as any)[approvedSetKey] = [...approved, intent.id]
		return { approved: true }
	}

	/**
	 * Initialize orchestration directory
	 */
	async initialize(): Promise<void> {
		await this.dataModel.initialize()
	}

	/**
	 * Pre-Hook: Intercept tool execution before it happens
	 * Enforces intent context injection and scope validation
	 */
	async preHook(toolName: ToolName, toolUse: ToolUse, task: Task): Promise<HookResult> {
		// Check if this is select_active_intent - allow it through
		if (toolName === "select_active_intent") {
			return { shouldProceed: true }
		}

		// For all other tools, check if active intent is set
		const activeIntentId = (task as any).activeIntentId as string | undefined
		let activeIntent = (task as any).activeIntent as ActiveIntent | undefined

		// Destructive tools require intent selection
		const destructiveTools: ToolName[] = [
			"write_to_file",
			"edit_file",
			"apply_diff",
			"apply_patch",
			"edit",
			"search_replace",
			"search_and_replace",
			"execute_command",
		]

		if (destructiveTools.includes(toolName)) {
			if (!activeIntentId) {
				return {
					shouldProceed: false,
					errorMessage:
						"You must cite a valid active Intent ID. Call select_active_intent(intent_id) before making code changes.",
				}
			}

			// Load intent details (for authorization prompt + scope checks)
			if (!activeIntent) {
				const loadedIntent = await this.dataModel.getIntent(activeIntentId)
				if (loadedIntent) {
					activeIntent = loadedIntent
					;(task as any).activeIntent = activeIntent
				}
			}

			if (!activeIntent) {
				return {
					shouldProceed: false,
					errorMessage: `Intent "${activeIntentId}" not found in active_intents.yaml. Please select a valid intent ID.`,
				}
			}

			// Validate scope for write operations
			if (toolName === "write_to_file" || toolName === "edit_file") {
				const filePath = (toolUse.params as any).path as string | undefined
				if (filePath) {
					// Phase 4: Optimistic Locking - Check for stale file
					const staleCheck = await this.checkStaleFile(filePath, task.cwd)
					if (!staleCheck.isCurrent) {
						return {
							shouldProceed: false,
							errorMessage: `Stale File Error: ${filePath} has been modified by another agent or process. Please re-read the file before making changes. Original hash: ${staleCheck.originalHash?.substring(0, 8)}..., Current hash: ${staleCheck.currentHash?.substring(0, 8)}...`,
						}
					}

					const scopeValid = await this.validateScope(activeIntentId, filePath, task.cwd)
					if (!scopeValid.valid) {
						return {
							shouldProceed: false,
							errorMessage: `Scope Violation: ${activeIntentId} is not authorized to edit ${filePath}. ${scopeValid.message}`,
						}
					}

					// UI-blocking authorization (HITL)
					const auth = await this.ensureIntentAuthorized(task, activeIntent, toolName, { filePath })
					if (!auth.approved) {
						return {
							shouldProceed: false,
							errorMessage: auth.message || "Operation rejected by user.",
						}
					}
				}
			} else if (toolName === "execute_command") {
				const command = (toolUse.params as any).command as string | undefined
				const auth = await this.ensureIntentAuthorized(task, activeIntent, toolName, { command })
				if (!auth.approved) {
					return {
						shouldProceed: false,
						errorMessage: auth.message || "Operation rejected by user.",
					}
				}
			} else {
				// Other destructive tools: still require UI-blocking authorization.
				const auth = await this.ensureIntentAuthorized(task, activeIntent, toolName)
				if (!auth.approved) {
					return {
						shouldProceed: false,
						errorMessage: auth.message || "Operation rejected by user.",
					}
				}
			}
		}

		return { shouldProceed: true }
	}

	/**
	 * Post-Hook: Execute after tool completes
	 * Updates trace logs and intent state
	 */
	async postHook(toolName: ToolName, toolUse: ToolUse, task: Task, success: boolean, result?: string): Promise<void> {
		const activeIntentId = (task as any).activeIntentId as string | undefined

		// Only log destructive operations
		const destructiveTools: ToolName[] = [
			"write_to_file",
			"edit_file",
			"apply_diff",
			"apply_patch",
			"edit",
			"search_replace",
			"search_and_replace",
		]

		// Defensive logging to diagnose why trace entries might be skipped
		console.log(
			`[PostHook] tool=${toolName}, success=${success}, activeIntentId=${activeIntentId || "NONE"}, isDestructive=${destructiveTools.includes(toolName)}`,
		)

		if (destructiveTools.includes(toolName) && activeIntentId && success) {
			await this.logTraceEntry(toolName, toolUse, task, activeIntentId, result)
			console.log(`[PostHook] Trace entry logged for ${toolName} under intent ${activeIntentId}`)
		} else if (destructiveTools.includes(toolName)) {
			if (!activeIntentId) {
				console.warn(`[PostHook] Skipping trace for ${toolName}: no activeIntentId set on task`)
			}
			if (!success) {
				console.warn(`[PostHook] Skipping trace for ${toolName}: tool execution failed`)
			}
		}
	}

	/**
	 * Validate that a file path is within the intent's owned scope
	 */
	private async validateScope(
		intentId: string,
		filePath: string,
		workspaceRoot: string,
	): Promise<{ valid: boolean; message?: string }> {
		try {
			const intent = await this.dataModel.getIntent(intentId)
			if (!intent) {
				return { valid: false, message: "Intent not found" }
			}

			const normalizedPath = path.normalize(filePath)
			const absolutePath = path.resolve(workspaceRoot, normalizedPath)

			// Check if file matches any scope pattern
			for (const scopePattern of intent.owned_scope) {
				// Simple glob matching (can be enhanced with minimatch later)
				if (this.matchesPattern(normalizedPath, scopePattern)) {
					return { valid: true }
				}
			}

			return {
				valid: false,
				message: `File is outside intent scope. Request scope expansion or use a different intent.`,
			}
		} catch (error) {
			console.error("Scope validation error:", error)
			return { valid: true } // Fail open on error
		}
	}

	/**
	 * Simple pattern matching (supports ** and *)
	 */
	private matchesPattern(filePath: string, pattern: string): boolean {
		// Convert glob pattern to regex
		const regexPattern = pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\//g, "\\/")
		const regex = new RegExp(`^${regexPattern}$`)
		return regex.test(filePath)
	}

	/**
	 * Check if a file is stale (has been modified since it was read)
	 * Phase 4: Optimistic Locking for Parallel Orchestration
	 */
	private async checkStaleFile(
		filePath: string,
		workspaceRoot: string,
	): Promise<{ isCurrent: boolean; originalHash?: string; currentHash?: string }> {
		try {
			const absolutePath = path.resolve(workspaceRoot, filePath)
			const normalizedPath = path.normalize(filePath)

			// Get the hash that was stored when the file was read
			const originalHash = this.fileHashCache.get(normalizedPath)

			// If we don't have a cached hash, this is a new file or first write - allow it
			if (!originalHash) {
				// Read current file to cache its hash
				try {
					const currentContent = await fs.readFile(absolutePath, "utf-8")
					const currentHash = this.dataModel.computeContentHash(currentContent)
					this.fileHashCache.set(normalizedPath, currentHash)
					return { isCurrent: true, currentHash }
				} catch {
					// File doesn't exist yet - this is a new file creation, allow it
					return { isCurrent: true }
				}
			}

			// Read current file content and compute hash
			try {
				const currentContent = await fs.readFile(absolutePath, "utf-8")
				const currentHash = this.dataModel.computeContentHash(currentContent)

				// Compare hashes
				if (originalHash !== currentHash) {
					return { isCurrent: false, originalHash, currentHash }
				}

				// File is current
				return { isCurrent: true, originalHash, currentHash }
			} catch {
				// File was deleted - consider it stale
				return { isCurrent: false, originalHash, currentHash: undefined }
			}
		} catch (error) {
			console.error("Stale file check error:", error)
			// Fail open on error to avoid blocking legitimate operations
			return { isCurrent: true }
		}
	}

	/**
	 * Track file hash when it's read (for optimistic locking)
	 * This should be called from read_file tool handler
	 */
	async trackFileRead(filePath: string, workspaceRoot: string): Promise<void> {
		try {
			const absolutePath = path.resolve(workspaceRoot, filePath)
			const normalizedPath = path.normalize(filePath)

			try {
				const content = await fs.readFile(absolutePath, "utf-8")
				const hash = this.dataModel.computeContentHash(content)
				this.fileHashCache.set(normalizedPath, hash)
			} catch {
				// File doesn't exist - that's okay, we'll track it when it's created
			}
		} catch (error) {
			console.error("Failed to track file read:", error)
		}
	}

	/**
	 * Classify mutation type: AST_REFACTOR vs INTENT_EVOLUTION
	 * AST_REFACTOR: Syntax/structure change, same functionality
	 * INTENT_EVOLUTION: New feature or functionality change
	 */
	private classifyMutation(
		toolName: ToolName,
		filePath: string,
		originalContent: string,
		newContent: string,
		intentId: string,
	): "AST_REFACTOR" | "INTENT_EVOLUTION" {
		// Heuristic: If the file is new or significantly different, it's INTENT_EVOLUTION
		// If it's a refactoring tool or similar structure, it's AST_REFACTOR

		// New file = INTENT_EVOLUTION
		if (!originalContent || originalContent.trim().length === 0) {
			return "INTENT_EVOLUTION"
		}

		// If using refactoring-specific tools, likely AST_REFACTOR
		if (toolName === "apply_patch" || toolName === "apply_diff") {
			// Check if it's a structural change (rename, move, extract) vs feature addition
			const originalLines = originalContent.split("\n").length
			const newLines = newContent.split("\n").length
			const lineDiff = Math.abs(newLines - originalLines)

			// Small changes (< 20% line difference) are likely refactors
			if (lineDiff / originalLines < 0.2) {
				return "AST_REFACTOR"
			}
		}

		// Compare content similarity
		const originalHash = this.dataModel.computeContentHash(originalContent)
		const newHash = this.dataModel.computeContentHash(newContent)

		// If hashes are very similar (small changes), likely AST_REFACTOR
		// For now, use a simple heuristic: if edit_file with small changes, it's a refactor
		if (toolName === "edit_file") {
			// Count significant differences (non-whitespace changes)
			const originalSignificant = originalContent.replace(/\s/g, "")
			const newSignificant = newContent.replace(/\s/g, "")
			const similarity = this.computeSimilarity(originalSignificant, newSignificant)

			// High similarity (> 80%) suggests refactoring
			if (similarity > 0.8) {
				return "AST_REFACTOR"
			}
		}

		// Default: assume INTENT_EVOLUTION for new features
		return "INTENT_EVOLUTION"
	}

	/**
	 * Compute similarity between two strings (simple Levenshtein-based)
	 */
	private computeSimilarity(str1: string, str2: string): number {
		if (str1 === str2) return 1.0
		if (str1.length === 0 || str2.length === 0) return 0.0

		const maxLen = Math.max(str1.length, str2.length)
		const distance = this.levenshteinDistance(str1, str2)
		return 1 - distance / maxLen
	}

	/**
	 * Compute Levenshtein distance between two strings
	 */
	private levenshteinDistance(str1: string, str2: string): number {
		const matrix: number[][] = []

		for (let i = 0; i <= str2.length; i++) {
			matrix[i] = [i]
		}

		for (let j = 0; j <= str1.length; j++) {
			matrix[0][j] = j
		}

		for (let i = 1; i <= str2.length; i++) {
			for (let j = 1; j <= str1.length; j++) {
				if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1]
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1, // substitution
						matrix[i][j - 1] + 1, // insertion
						matrix[i - 1][j] + 1, // deletion
					)
				}
			}
		}

		return matrix[str2.length][str1.length]
	}

	/**
	 * Log trace entry to agent_trace.jsonl
	 */
	private async logTraceEntry(
		toolName: ToolName,
		toolUse: ToolUse,
		task: Task,
		intentId: string,
		result?: string,
	): Promise<void> {
		try {
			// Get current git revision
			let gitRevision = "unknown"
			try {
				gitRevision = execSync("git rev-parse HEAD", { cwd: task.cwd, encoding: "utf-8" }).trim()
			} catch {
				// Git not available or not a git repo
			}

			// Extract file path and content from tool params
			const params = toolUse.params as any
			const filePath = params.path as string | undefined

			if (!filePath) {
				return // Can't log without file path
			}

			// Read file content to compute hash
			const absolutePath = path.resolve(task.cwd, filePath)
			let fileContent = ""
			let originalContent = ""
			let startLine = 1
			let endLine = 1

			// Try to read original content for mutation classification
			const normalizedPath = path.normalize(filePath)
			const originalHash = this.fileHashCache.get(normalizedPath)
			if (originalHash) {
				try {
					// We need to reconstruct original content - for now, read current and classify
					// In a real implementation, you'd store the original content
					originalContent = ""
				} catch {
					// Original content not available
				}
			}

			try {
				fileContent = await fs.readFile(absolutePath, "utf-8")
				const lines = fileContent.split("\n")
				endLine = lines.length

				// If we have line numbers in params, use them
				if (params.start_line !== undefined && params.end_line !== undefined) {
					startLine = params.start_line
					endLine = params.end_line
				}
			} catch {
				// File doesn't exist or can't be read
				return
			}

			// Extract relevant code block
			const lines = fileContent.split("\n")
			const relevantLines = lines.slice(Math.max(0, startLine - 1), endLine)
			const codeBlock = relevantLines.join("\n")
			const contentHash = this.dataModel.computeContentHash(codeBlock)

			// Classify mutation type
			const mutationClass = this.classifyMutation(toolName, filePath, originalContent, fileContent, intentId)

			// Update file hash cache after successful write
			this.fileHashCache.set(normalizedPath, this.dataModel.computeContentHash(fileContent))

			// Get model identifier from task
			const modelId = task.api.getModel().id

			// Build trace entry with mutation classification
			const traceEntry = {
				id: `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				timestamp: new Date().toISOString(),
				vcs: {
					revision_id: gitRevision,
				},
				files: [
					{
						relative_path: filePath,
						conversations: [
							{
								url: `task-${task.taskId}`,
								contributor: {
									entity_type: "AI" as const,
									model_identifier: modelId,
								},
								ranges: [
									{
										start_line: startLine,
										end_line: endLine,
										content_hash: `sha256:${contentHash}`,
									},
								],
								related: [
									{
										type: "intent" as const,
										value: intentId,
									},
								],
							},
						],
					},
				],
				mutation_class: mutationClass,
			}

			await this.dataModel.appendTraceEntry(traceEntry)
		} catch (error) {
			console.error("Failed to log trace entry:", error)
			// Don't throw - logging failures shouldn't break tool execution
		}
	}
}
