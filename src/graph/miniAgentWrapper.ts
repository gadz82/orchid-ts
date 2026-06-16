export class MiniAgentWrapper {
    static async shouldDecompose(
        agentConfig: Record<string, unknown>,
        chatModel: unknown,
        mcpClients: unknown[],
        auth: unknown,
        state: Record<string, unknown>,
    ): Promise<boolean> {
        try {
            const { maybeDecompose } = await import("../agents/miniAgentDecomposer.js");
            const result = await (maybeDecompose as (...args: unknown[]) => unknown)({
                agentConfig,
                chatModel,
                mcpClients,
                auth,
                state,
            });
            return result != null && "miniAgentDecisions" in result;
        } catch {
            return false;
        }
    }

    static wrapNode(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        node: Function,
        agentConfig: Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    ): Function {
        const miniEnabled =
            agentConfig.miniAgent != null &&
            typeof agentConfig.miniAgent === "object" &&
            (agentConfig.miniAgent as Record<string, unknown>).enabled === true;

        if (!miniEnabled) return node;

        return node;
    }
}
