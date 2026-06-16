import { OrchidSparseEncoder } from "../../core/sparse.js";
import { BM25SparseEncoder } from "./bm25.js";

type SparseEncoderClass = new (...args: any[]) => OrchidSparseEncoder;

const BUILTINS: Record<string, SparseEncoderClass> = {
    bm25: BM25SparseEncoder,
};

export const SPARSE_ENCODER_REGISTRY: Record<string, SparseEncoderClass> = { ...BUILTINS };

export function registerSparseEncoder(name: string, cls: SparseEncoderClass): void {
    if (name in SPARSE_ENCODER_REGISTRY && SPARSE_ENCODER_REGISTRY[name] !== cls) {
        console.warn(
            "[SparseEncoders] '%s' already registered (was %s); overwriting",
            name,
            SPARSE_ENCODER_REGISTRY[name].name,
        );
    }
    SPARSE_ENCODER_REGISTRY[name] = cls;
    console.error("[SparseEncoders] Registered '%s'", name);
}

export function getSparseEncoder(
    name: string,
    kwargs?: Record<string, unknown>,
): OrchidSparseEncoder {
    const Cls = SPARSE_ENCODER_REGISTRY[name];
    if (!Cls) {
        throw new Error(
            `Unknown sparse encoder '${name}'. ` +
                `Registered: ${Object.keys(SPARSE_ENCODER_REGISTRY).sort().join(", ")}. ` +
                `Call registerSparseEncoder('${name}', cls) before use.`,
        );
    }
    return kwargs ? new Cls(kwargs) : new Cls();
}

export function clearSparseEncoders(): void {
    for (const key of Object.keys(SPARSE_ENCODER_REGISTRY)) {
        delete SPARSE_ENCODER_REGISTRY[key];
    }
    Object.assign(SPARSE_ENCODER_REGISTRY, BUILTINS);
}

export { BM25SparseEncoder };
