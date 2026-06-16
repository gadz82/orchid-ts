import { createHash } from "node:crypto";
import { OrchidSparseEncoder } from "../../core/sparse.js";
import type { OrchidSparseVector } from "../../core/sparse.js";

const K1 = 1.5;
const B = 0.75;
const DEFAULT_DRIFT = 0.2;
const DEFAULT_VOCAB_SIZE = 100_000;

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_-]*/g;

const STOP_WORDS: ReadonlySet<string> = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "was",
    "were",
    "will",
    "with",
]);

function tokenize(text: string): string[] {
    const matches = text.match(TOKEN_RE) ?? [];
    return matches.filter((t) => !STOP_WORDS.has(t.toLowerCase())).map((t) => t.toLowerCase());
}

function hashToken(token: string, vocabSize: number): number {
    const digest = createHash("md5").update(token).digest();
    return (
        ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>>
        (0 % vocabSize)
    );
}

interface NamespaceState {
    df: Map<string, number>;
    nDocuments: number;
    totalDocLength: number;
    avgdl: number;
    lastRefreshN: number;
}

export class BM25SparseEncoder extends OrchidSparseEncoder {
    private vocabSize: number;
    private driftThreshold: number;
    private states = new Map<string, NamespaceState>();

    constructor({
        vocabSize = DEFAULT_VOCAB_SIZE,
        driftThreshold = DEFAULT_DRIFT,
    }: {
        vocabSize?: number;
        driftThreshold?: number;
    } = {}) {
        super();
        if (vocabSize < 1024) throw new Error(`vocabSize must be >= 1024; got ${vocabSize}`);
        if (driftThreshold <= 0 || driftThreshold >= 1)
            throw new Error(`driftThreshold must be in (0, 1); got ${driftThreshold}`);
        this.vocabSize = vocabSize;
        this.driftThreshold = driftThreshold;
    }

    get stats(): ReadonlyMap<string, NamespaceState> {
        return this.states;
    }

    override async encode(query: string): Promise<OrchidSparseVector> {
        return this.encodeQuery(query);
    }

    async encodeQuery(query: string, namespace = "default"): Promise<OrchidSparseVector> {
        const state = this.getState(namespace);
        const tokens = this.doTokenize(query);
        if (!tokens.length) return { indices: [], values: [] };
        return this.weightQuery(state, tokens);
    }

    async encodeDocuments(texts: string[], namespace = "default"): Promise<OrchidSparseVector[]> {
        const state = this.getState(namespace);
        const out: OrchidSparseVector[] = [];
        for (const text of texts) {
            const tokens = this.doTokenize(text);
            if (!tokens.length) {
                out.push({ indices: [], values: [] });
                continue;
            }
            this.updateCorpusStats(state, tokens);
            out.push(this.weightDoc(state, tokens));
        }
        return out;
    }

    protected doTokenize(text: string): string[] {
        return tokenize(text);
    }

    private getState(namespace: string): NamespaceState {
        let state = this.states.get(namespace);
        if (!state) {
            state = { df: new Map(), nDocuments: 0, totalDocLength: 0, avgdl: 0, lastRefreshN: 0 };
            this.states.set(namespace, state);
        }
        return state;
    }

    private updateCorpusStats(state: NamespaceState, tokens: string[]): void {
        for (const tok of new Set(tokens)) {
            state.df.set(tok, (state.df.get(tok) ?? 0) + 1);
        }
        state.nDocuments += 1;
        state.totalDocLength += tokens.length;
        if (state.lastRefreshN === 0) {
            state.avgdl = state.totalDocLength / state.nDocuments;
            state.lastRefreshN = state.nDocuments;
            return;
        }
        const drift =
            Math.abs(state.nDocuments - state.lastRefreshN) / Math.max(state.lastRefreshN, 1);
        if (drift >= this.driftThreshold) {
            state.avgdl = state.totalDocLength / state.nDocuments;
            state.lastRefreshN = state.nDocuments;
        }
    }

    private weightDoc(state: NamespaceState, tokens: string[]): OrchidSparseVector {
        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
        const n = state.nDocuments;
        const avgdl = state.avgdl || 1.0;
        const docLen = tokens.length;

        const indices: number[] = [];
        const values: number[] = [];
        for (const [tok, freq] of tf) {
            const df = Math.max(state.df.get(tok) ?? 0, 1);
            const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1.0);
            const denom = freq + K1 * (1.0 - B + (B * docLen) / avgdl);
            const tfWeight = (freq * (K1 + 1.0)) / Math.max(denom, 1e-9);
            const weight = idf * tfWeight;
            if (weight > 0) {
                indices.push(hashToken(tok, this.vocabSize));
                values.push(weight);
            }
        }
        return { indices, values };
    }

    private weightQuery(state: NamespaceState, tokens: string[]): OrchidSparseVector {
        if (state.nDocuments === 0) {
            const seen = new Set<string>();
            const indices: number[] = [];
            const values: number[] = [];
            for (const tok of tokens) {
                if (seen.has(tok)) continue;
                seen.add(tok);
                indices.push(hashToken(tok, this.vocabSize));
                values.push(1.0);
            }
            return { indices, values };
        }
        const n = state.nDocuments;
        const seen = new Set<string>();
        const indices: number[] = [];
        const values: number[] = [];
        for (const tok of tokens) {
            if (seen.has(tok)) continue;
            seen.add(tok);
            const df = state.df.get(tok);
            if (!df) continue;
            const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1.0);
            if (idf > 0) {
                indices.push(hashToken(tok, this.vocabSize));
                values.push(idf);
            }
        }
        return { indices, values };
    }
}
