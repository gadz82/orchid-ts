import { OrchidRetrievalStrategy } from "../../core/retrieval.js";
import { SimpleRetrieval } from "./simple.js";
import { MultiQueryRetrieval } from "./multiQuery.js";
import { HyDERetrieval } from "./hyde.js";
import { HybridRetrieval } from "./hybrid.js";
import { GraphRAGRetrieval } from "./graphRag.js";

const BUILTINS: Record<string, new (...args: any[]) => OrchidRetrievalStrategy> = {
    simple: SimpleRetrieval,
    multi_query: MultiQueryRetrieval,
    hyde: HyDERetrieval,
    hybrid: HybridRetrieval,
    graph_rag: GraphRAGRetrieval,
};

export const RETRIEVAL_REGISTRY: Record<string, new (...args: any[]) => OrchidRetrievalStrategy> = {
    ...BUILTINS,
};

export function registerRetrievalStrategy(
    name: string,
    cls: new (...args: any[]) => OrchidRetrievalStrategy,
): void {
    if (name in RETRIEVAL_REGISTRY && RETRIEVAL_REGISTRY[name] !== cls) {
        console.warn(
            "[RetrievalStrategies] '%s' already registered (was %s); overwriting",
            name,
            RETRIEVAL_REGISTRY[name].name,
        );
    }
    RETRIEVAL_REGISTRY[name] = cls;
    console.error("[RetrievalStrategies] Registered '%s'", name);
}

export function clearStrategies(): void {
    for (const key of Object.keys(RETRIEVAL_REGISTRY)) {
        delete RETRIEVAL_REGISTRY[key];
    }
    Object.assign(RETRIEVAL_REGISTRY, BUILTINS);
}

export function getRetrievalStrategy(name: string, config?: unknown): OrchidRetrievalStrategy {
    let Cls = RETRIEVAL_REGISTRY[name];
    if (!Cls) {
        console.warn("Unknown retrieval strategy '%s', falling back to 'simple'", name);
        Cls = RETRIEVAL_REGISTRY["simple"] ?? SimpleRetrieval;
    }
    if (config !== undefined && typeof (Cls as any).fromConfig === "function") {
        return (Cls as any).fromConfig(config);
    }
    return new Cls();
}

export { SimpleRetrieval, MultiQueryRetrieval, HyDERetrieval, HybridRetrieval, GraphRAGRetrieval };
