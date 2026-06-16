import type { OrchidAgentPromptConfig } from "../config/schema/index.js";
import type { MCPCapabilities } from "./mcpDispatcher.js";

export type { MCPCapabilities } from "./mcpDispatcher.js";

export class SystemPromptBuilder {
    private sections: OrchidAgentPromptConfig;

    constructor(promptSections: OrchidAgentPromptConfig) {
        this.sections = promptSections;
    }

    build(
        basePrompt: string,
        opts: {
            caps: MCPCapabilities;
            ragData: Array<Record<string, unknown>>;
            state?: Record<string, unknown> | null;
            agentName: string;
            ragMaxContextChars?: number;
        },
    ): string {
        const { caps, ragData, state, agentName: _agentName, ragMaxContextChars = 3000 } = opts;
        const parts: string[] = [basePrompt];

        // Prior tool results from previous turns
        const priorCtx = state
            ? (state["mcp_context"] as Record<string, unknown> | undefined)?.[_agentName]
            : undefined;
        if (priorCtx) {
            parts.push(this.sections.priorResultsHeader);
            const serialised = JSON.stringify(priorCtx, null, 2);
            parts.push(serialised.slice(0, this.sections.priorResultsMaxChars));
        }

        // Rendered MCP prompts (zero-arg prompts evaluated at discovery time)
        if (caps.renderedPrompts && caps.renderedPrompts.length > 0) {
            for (const prompt of caps.renderedPrompts) {
                parts.push(
                    this.sections.mcpPromptTemplate
                        .replace("{name}", prompt.name)
                        .replace("{text}", prompt.text),
                );
            }
        }

        // Prompts that require arguments
        if (caps.skippedPrompts && caps.skippedPrompts.length > 0) {
            for (const sp of caps.skippedPrompts) {
                parts.push(
                    this.sections.skippedPromptTemplate
                        .replace("{name}", sp.name)
                        .replace("{description}", sp.description)
                        .replace("{requiredArgs}", sp.requiredArgs.join(", ")),
                );
            }
        }

        // MCP resource contents
        if (caps.resourceContents && caps.resourceContents.size > 0) {
            parts.push(this.sections.resourcesHeader);
            for (const [name, content] of caps.resourceContents) {
                parts.push(
                    this.sections.resourceTemplate
                        .replace("{name}", name)
                        .replace("{content}", content.slice(0, this.sections.resourceMaxChars)),
                );
            }
        }

        // RAG context
        if (ragData.length > 0) {
            parts.push(this.sections.ragHeader);
            const serialised = JSON.stringify(ragData, null, 2);
            parts.push(serialised.slice(0, ragMaxContextChars));
        }

        return parts.join("\n");
    }
}
