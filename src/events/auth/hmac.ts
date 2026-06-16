import crypto from "node:crypto";

export class HMACEventAuth {
    private _secret: Buffer;
    private _algorithm: string;

    constructor(secret: string, algorithm = "sha256") {
        this._secret = Buffer.from(secret, "utf-8");
        this._algorithm = algorithm;
    }

    async authenticate(payload: string, signature: string): Promise<boolean> {
        const expected = this.sign(payload);
        return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    }

    sign(payload: string): string {
        return crypto
            .createHmac(this._algorithm, this._secret)
            .update(payload, "utf-8")
            .digest("hex");
    }
}
