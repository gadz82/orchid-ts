/** Content source descriptor — what persistent content an agent draws from. */

export interface OrchidContentSource {
    type: string;
    uri: string;
    description?: string;
}
