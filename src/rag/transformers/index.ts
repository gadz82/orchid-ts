import { OrchidQueryTransformer } from "../../core/retrieval.js";
import { ReformulateTransformer } from "./reformulate.js";
import { MultiQueryTransformer } from "./multiQuery.js";
import { HyDETransformer } from "./hyde.js";
import { DecomposeTransformer } from "./decompose.js";

const BUILTINS: Record<string, new (...args: any[]) => OrchidQueryTransformer> = {
    reformulate: ReformulateTransformer,
    multi_query: MultiQueryTransformer,
    hyde: HyDETransformer,
    decompose: DecomposeTransformer,
};

export const TRANSFORMER_REGISTRY: Record<string, new (...args: any[]) => OrchidQueryTransformer> =
    { ...BUILTINS };

export function registerQueryTransformer(
    name: string,
    cls: new (...args: any[]) => OrchidQueryTransformer,
): void {
    if (name in TRANSFORMER_REGISTRY && TRANSFORMER_REGISTRY[name] !== cls) {
        console.warn(
            "[QueryTransformers] '%s' already registered (was %s); overwriting",
            name,
            TRANSFORMER_REGISTRY[name].name,
        );
    }
    TRANSFORMER_REGISTRY[name] = cls;
    console.error("[QueryTransformers] Registered '%s'", name);
}

export function clearQueryTransformers(): void {
    for (const key of Object.keys(TRANSFORMER_REGISTRY)) {
        delete TRANSFORMER_REGISTRY[key];
    }
    Object.assign(TRANSFORMER_REGISTRY, BUILTINS);
}

export function getQueryTransformer(
    name: string,
    kwargs?: Record<string, unknown>,
): OrchidQueryTransformer {
    const Cls = TRANSFORMER_REGISTRY[name];
    if (!Cls) {
        throw new Error(
            `Unknown query transformer '${name}'. ` +
                `Registered: ${Object.keys(TRANSFORMER_REGISTRY).sort().join(", ")}. ` +
                `Call registerQueryTransformer('${name}', cls) before use.`,
        );
    }
    return kwargs ? new Cls(kwargs) : new Cls();
}

export function resolveTransformerKwargs(
    name: string,
    prompts: Record<string, unknown> | null,
): Record<string, unknown> {
    if (!prompts) return {};
    switch (name) {
        case "multi_query": {
            const val = prompts["multi_query"];
            return val ? { systemPrompt: val } : {};
        }
        case "decompose": {
            const val = prompts["decompose"];
            return val ? { systemPrompt: val } : {};
        }
        case "reformulate": {
            const val = prompts["reformulate"];
            return val ? { systemPrompt: val } : {};
        }
        case "hyde": {
            const hyde = prompts["hyde"] as Record<string, unknown> | undefined;
            if (!hyde) return {};
            const out: Record<string, unknown> = {};
            if (hyde["single"]) out["singlePrompt"] = hyde["single"];
            if (hyde["multi"]) out["multiPrompt"] = hyde["multi"];
            return out;
        }
        default:
            return {};
    }
}

export { ReformulateTransformer, MultiQueryTransformer, HyDETransformer, DecomposeTransformer };
