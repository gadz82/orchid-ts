export class BearerEventAuth {
    constructor(private _token?: string) {}

    async authenticate(headers: Record<string, string>): Promise<boolean> {
        const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
        if (!authHeader.startsWith("Bearer ")) return false;
        const token = authHeader.slice(7);
        if (this._token !== undefined) {
            return token === this._token;
        }
        return token.length > 0;
    }
}
