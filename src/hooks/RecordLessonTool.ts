import { Task } from "../core/task/Task"
import { formatResponse } from "../core/prompts/responses"
import { BaseTool, ToolCallbacks } from "../core/tools/BaseTool"
import type { ToolUse } from "../shared/tools"
import { OrchestrationDataModel } from "./OrchestrationDataModel"
import * as path from "path"
import * as fs from "fs/promises"

interface RecordLessonParams {
	lesson: string
	intent_id?: string
	category: "code_style" | "architecture" | "bug_fix" | "performance" | "testing" | "other"
}

/**
 * Tool for recording lessons learned to AGENT.md (Phase 4: Parallel Orchestration)
 * This tool appends lessons learned when verification steps (linter/test) fail.
 */
export class RecordLessonTool extends BaseTool<"record_lesson"> {
	readonly name = "record_lesson" as const

	async execute(params: RecordLessonParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { lesson, intent_id, category } = params
		const { pushToolResult, handleError } = callbacks

		try {
			if (!lesson) {
				task.consecutiveMistakeCount++
				task.recordToolError("record_lesson")
				pushToolResult(await task.sayAndCreateMissingParamError("record_lesson", "lesson"))
				return
			}

			// Initialize orchestration data model
			const dataModel = new OrchestrationDataModel(task.cwd)
			await dataModel.initialize()

			// Get AGENT.md path
			const agentPath = path.join(dataModel.getOrchestrationDir(), "AGENT.md")

			// Read current content
			let currentContent = ""
			try {
				currentContent = await fs.readFile(agentPath, "utf-8")
			} catch {
				// File doesn't exist or can't be read - will create it
			}

			// Format the lesson entry
			const timestamp = new Date().toISOString().split("T")[0]
			const intentRef = intent_id ? `\n- **Related Intent:** ${intent_id}` : ""
			const lessonEntry = `### ${timestamp}: ${category.charAt(0).toUpperCase() + category.slice(1).replace("_", " ")}${intentRef}

${lesson}

---

`

			// Find the "Lessons Learned" section and append
			const lessonsSection = "## Lessons Learned"
			if (currentContent.includes(lessonsSection)) {
				// Insert after the section header
				const sectionIndex = currentContent.indexOf(lessonsSection)
				const afterHeader = currentContent.indexOf("\n", sectionIndex) + 1
				const newContent =
					currentContent.slice(0, afterHeader) + lessonEntry + currentContent.slice(afterHeader)
				await fs.writeFile(agentPath, newContent, "utf-8")
			} else {
				// Create the section if it doesn't exist
				const newContent = currentContent + `\n${lessonsSection}\n\n${lessonEntry}`
				await fs.writeFile(agentPath, newContent, "utf-8")
			}

			// Reset mistake count on success
			task.consecutiveMistakeCount = 0

			// Return success message
			pushToolResult(`Lesson recorded to .orchestration/AGENT.md${intent_id ? ` (related to ${intent_id})` : ""}`)

			return
		} catch (error) {
			await handleError("recording lesson", error as Error)
			return
		}
	}
}

export const recordLessonTool = new RecordLessonTool()
