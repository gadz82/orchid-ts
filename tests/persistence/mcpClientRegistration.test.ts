import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OrchidSQLiteMCPClientRegistrationStore } from "../../src/persistence/mcpClientRegistrationSqlite.js";
import { OrchidMCPClientRegistration } from "../../src/core/mcpRegistration.js";

let store: OrchidSQLiteMCPClientRegistrationStore;

beforeEach(async () => {
    store = new OrchidSQLiteMCPClientRegistrationStore(":memory:");
    await store.initDb();
});

afterEach(async () => {
    await store.close();
});

describe("OrchidSQLiteMCPClientRegistrationStore", () => {
    it("saves and retrieves a registration", async () => {
        const reg = new OrchidMCPClientRegistration({
            serverName: "crm-api",
            authorizationEndpoint: "https://auth.example.com/authorize",
            tokenEndpoint: "https://auth.example.com/token",
            registrationEndpoint: "https://auth.example.com/register",
            clientId: "client-abc",
            clientSecret: "secret-xyz",
        });
        await store.save(reg);

        const retrieved = await store.get("crm-api");
        expect(retrieved).not.toBeNull();
        expect(retrieved!.clientId).toBe("client-abc");
        expect(retrieved!.authorizationEndpoint).toBe("https://auth.example.com/authorize");
    });

    it("returns null for missing registration", async () => {
        const result = await store.get("nonexistent");
        expect(result).toBeNull();
    });

    it("deletes a registration", async () => {
        await store.save(
            new OrchidMCPClientRegistration({
                serverName: "to-delete",
                authorizationEndpoint: "https://auth.example.com/authorize",
                tokenEndpoint: "https://auth.example.com/token",
            }),
        );
        const deleted = await store.delete("to-delete");
        expect(deleted).toBe(true);

        const result = await store.get("to-delete");
        expect(result).toBeNull();
    });

    it("delete returns false for missing", async () => {
        const result = await store.delete("nonexistent");
        expect(result).toBe(false);
    });
});
