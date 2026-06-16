/** Normalised MCP tool-call result. */

export interface MCPContentBlock {
    type: string;
    text?: string;
    [key: string]: unknown;
}

export class OrchidMCPToolResult {
    content: MCPContentBlock[];
    isError: boolean;

    constructor(content: MCPContentBlock[] = [], isError = false) {
        this.content = content;
        this.isError = isError;
    }

    get text(): string {
        return this.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n");
    }
}
