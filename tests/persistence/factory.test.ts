import { describe, it, expect } from "vitest";
import { buildChatStorage } from "../../src/persistence/factory.js";
import { buildMCPTokenStore } from "../../src/persistence/mcpTokenFactory.js";
import { OrchidSQLiteChatStorage } from "../../src/persistence/sqlite.js";
import { OrchidSQLiteMCPTokenStore } from "../../src/persistence/mcpTokenSqlite.js";

describe("Persistence Factory", () => {
    it("buildChatStorage resolves sqlite shortcut", () => {
        const storage = buildChatStorage("sqlite", ":memory:");
        expect(storage).toBeInstanceOf(OrchidSQLiteChatStorage);
    });

    it("buildChatStorage throws for unknown shortcut", () => {
        expect(() => buildChatStorage("postgres", "postgresql://localhost/db")).toThrow();
    });

    it("buildMCPTokenStore resolves sqlite shortcut", () => {
        const store = buildMCPTokenStore("sqlite", ":memory:");
        expect(store).toBeInstanceOf(OrchidSQLiteMCPTokenStore);
    });

    it("buildMCPTokenStore throws for unknown shortcut", () => {
        expect(() => buildMCPTokenStore("postgres", "postgresql://localhost/db")).toThrow();
    });
});
