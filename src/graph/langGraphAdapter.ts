export class LangGraphAdapter {
    static async createStateGraph(channels: Record<string, unknown>): Promise<unknown> {
        try {
            const { StateGraph } = await import("@langchain/langgraph");
            const StateGraphCtor = StateGraph as unknown as new (init: {
                channels: Record<string, unknown>;
            }) => unknown;
            return new StateGraphCtor({ channels });
        } catch {
            // LangGraph may not be installed — return a stub
            return {
                _channels: channels,
                _nodes: {} as Record<string, unknown>,
                _edges: [] as Array<{ from: string; to: string }>,
                addNode(name: string, node: unknown) {
                    (this as any)._nodes[name] = node;
                },
                addEdge(from: string, to: string) {
                    (this as any)._edges.push({ from, to });
                },
                addConditionalEdges(source: string, router: unknown, destinations?: string[]) {
                    (this as any)._conditionalEdges = (this as any)._conditionalEdges ?? {};
                    (this as any)._conditionalEdges[source] = { router, destinations };
                },
                setEntryPoint(name: string) {
                    (this as any)._entryPoint = name;
                },
                compile(opts?: Record<string, unknown>) {
                    return {
                        _compiled: true,
                        _channels: (this as any)._channels,
                        _nodes: (this as any)._nodes,
                        opts,
                    };
                },
                setFinishPoint(name: string) {
                    (this as any)._finishPoint = name;
                },
            };
        }
    }
}
