import type OpenAI from "openai"

/**
 * Tool for recording lessons learned to AGENT.md (Phase 4: Parallel Orchestration)
 * This tool appends lessons learned when verification steps (linter/test) fail.
 */
const recordLesson: OpenAI.Chat.ChatCompletionFunctionTool = {
	type: "function",
	function: {
		name: "record_lesson",
		description:
			"Record a lesson learned to .orchestration/AGENT.md. Use this when a verification step (linter, test, etc.) fails or when you discover important patterns or constraints. This knowledge is shared across parallel agent sessions.",
		parameters: {
			type: "object",
			properties: {
				lesson: {
					type: "string",
					description:
						"The lesson learned, including the issue, solution, and impact. Should be formatted as markdown.",
				},
				intent_id: {
					type: "string",
					description:
						"Optional: The intent ID this lesson relates to (e.g., 'INT-001'). If not provided, the lesson is general.",
				},
				category: {
					type: "string",
					enum: ["code_style", "architecture", "bug_fix", "performance", "testing", "other"],
					description: "Category of the lesson learned.",
				},
			},
			required: ["lesson", "category"],
		},
	},
}

export default recordLesson
