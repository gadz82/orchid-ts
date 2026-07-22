import type { ChatModelLike } from "../core/helpers.js";
import type { GraphState } from "./state.js";

export class MiniAgentWiring {
    static makeForkRouter(
        parentName: string,
    ): (state: GraphState) => Array<{ node: string; args: Record<string, unknown> }> | string {
        return function forkRouter(state: GraphState) {
            const decisions = (state.miniAgentDecisions ?? {}) as Record<
                string,
                Record<string, unknown>
            >;
            const decision = decisions[parentName];
            console.info(
                "[Route] mini-agent fork router for '%s': decision=%s, shouldFork=%s",
                parentName,
                decision ? "present" : "absent",
                Boolean(decision?.shouldFork),
            );
            if (!decision || !decision.shouldFork) return "supervisor";

            const subTasks = (decision.subTasks ?? decision.sub_tasks ?? []) as Array<
                Record<string, unknown>
            >;
            if (subTasks.length === 0) return "supervisor";

            const sends: Array<{ node: string; args: Record<string, unknown> }> = [];
            for (let i = 0; i < subTasks.length; i++) {
                const subTask = subTasks[i];
                const miniId = (subTask.id as string) ?? `mini_${i}`;
                const toolSubset =
                    (subTask.resolvedToolSubset as string[]) ??
                    (subTask.allowedTools as string[]) ??
                    [];

                sends.push({
                    node: `${parentName}_mini`,
                    args: {
                        ...state,
                        activeMiniParent: parentName,
                        activeMiniId: miniId,
                        activeMiniSubtask: subTask,
                        activeMiniToolSubset: [...toolSubset],
                    },
                });
            }
            console.info(
                "[Route] %s parent forking into %d mini-agent(s)",
                parentName,
                sends.length,
            );
            return sends;
        };
    }

    static async wireMiniTopology(
        graph: Record<string, unknown>,
        agentName: string,
        agentConfig: Record<string, unknown>,
        agentChatModel: ChatModelLike | null,
        agentMCPClients: unknown[] | null = null,
        nodeName: string = "",
    ): Promise<void> {
        // Mini-agent modules are optional peers. If they are not
        // installed we cannot wire the topology — propagate the error
        // so the caller can fall back to a plain `addEdge(node, "supervisor")`.
        // Without the rethrow the silent catch below would let the
        // outer try-block complete successfully and the caller's
        // fallback `addEdge` would never run, leaving the agent node
        // with NO outgoing edges — LangGraph then treats it as a
        // terminal node and the graph ends prematurely (quiz-generator
        // case in the education example).
        const { miniAgentNodeFactory } = await import("../agents/miniAgentNode.js");
        const { aggregatorNodeFactory } = await import("../agents/miniAgentAggregator.js");

        const miniNode = miniAgentNodeFactory({
            parentConfig: agentConfig,
            chatModel: agentChatModel as ChatModelLike,
            mcpClients: agentMCPClients ?? [],
        });
        const aggregatorNode = aggregatorNodeFactory({
            parentConfig: agentConfig,
            chatModel: agentChatModel as ChatModelLike,
        });

        // Bind methods to `graph` so `this` is preserved when invoked
        // as standalone functions. LangGraph's StateGraph reads
        // `this.channels` / `this.nodes` etc.; without `.bind(graph)`
        // the call throws "Cannot read properties of undefined
        // (reading 'channels')" and the topology is left half-wired.
        const addNode = (graph.addNode as (...args: unknown[]) => unknown).bind(graph) as (
            name: string,
            node: unknown,
        ) => void;
        const addConditionalEdges = (
            graph.addConditionalEdges as (...args: unknown[]) => unknown
        ).bind(graph) as (
            source: string,
            router: unknown,
            destinations: string[],
        ) => void;
        const addEdge = (graph.addEdge as (...args: unknown[]) => unknown).bind(graph) as (
            source: string,
            target: string,
        ) => void;

        addNode(`${agentName}_mini`, miniNode);
        addNode(`${agentName}_aggregator`, aggregatorNode);
        addConditionalEdges(nodeName, MiniAgentWiring.makeForkRouter(agentName), [
            `${agentName}_mini`,
            "supervisor",
        ]);
        addEdge(`${agentName}_mini`, `${agentName}_aggregator`);
        addEdge(`${agentName}_aggregator`, "supervisor");

        console.info(
            "[Graph] agent %s wired with mini-agent topology (max_count=%d)",
            agentName,
            (agentConfig.miniAgent as Record<string, unknown>)?.maxCount ?? 3,
        );
    }
}
