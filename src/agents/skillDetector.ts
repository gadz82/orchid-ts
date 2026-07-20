import type { ChatModelLike } from "../core/index.js";
import { extractTextContent } from "../core/helpers.js";
import type { OrchidAgentSkillConfig } from "../config/schema/index.js";

export class SkillDetector {
    private chatModel: ChatModelLike;

    constructor(chatModel: ChatModelLike) {
        this.chatModel = chatModel;
    }

    async detect(
        query: string,
        skills: Record<string, OrchidAgentSkillConfig>,
    ): Promise<string | null> {
        if (Object.keys(skills).length === 0) {
            return null;
        }

        const skillDescriptions = Object.entries(skills)
            .map(([name, skill]) => `- "${name}": ${skill.description}`)
            .join("\n");

        const prompt =
            `User query: ${query}\n\n` +
            `Available skills for this agent:\n${skillDescriptions}\n\n` +
            `If the user's query closely matches one of these skills, respond with ` +
            `ONLY the skill name (e.g. "course_completion_summary").\n` +
            `If no skill matches, respond with "none".\n` +
            `Respond with ONLY the skill name or "none", nothing else.`;

        try {
            const result = await this.chatModel.invoke([{ role: "user", content: prompt }], {
                temperature: 0,
            });
            const text = extractTextContent(result.content).trim().replace(/^["']|["']$/g, "");
            if (text in skills) {
                return text;
            }
        } catch {
            // Detection failure is non-fatal — fall through to return null
        }

        return null;
    }
}
