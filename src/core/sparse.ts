/** Sparse vector encoding abstractions. */

export interface OrchidSparseVector {
    indices: number[];
    values: number[];
}

export abstract class OrchidSparseEncoder {
    abstract encode(query: string): Promise<OrchidSparseVector>;
}
