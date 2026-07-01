import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStartupHooks } from "../../src/orchid/lifecycle.js";

describe("runStartupHooks", () => {
    const orchid = { runtime: { configDir: "/fake/config" } };

    it("should be a no-op for empty hookPath", async () => {
        await runStartupHooks("", orchid);
        // no error thrown
    });

    it("should call default export when no # fragment", async () => {
        const hookFn = vi.fn().mockResolvedValue(undefined);
        vi.doMock("/fake/config/hooks/startup.ts", () => ({ default: hookFn }));

        await runStartupHooks("./hooks/startup.ts", orchid);
        expect(hookFn).toHaveBeenCalledWith(orchid);

        vi.doUnmock("/fake/config/hooks/startup.ts");
    });

    it("should call named export when # fragment is present", async () => {
        const namedFn = vi.fn().mockResolvedValue(undefined);
        const defaultFn = vi.fn().mockResolvedValue(undefined);
        vi.doMock("/fake/config/hooks/startup.ts", () => ({
            default: defaultFn,
            seedCarDealerFleet: namedFn,
        }));

        await runStartupHooks("./hooks/startup.ts#seedCarDealerFleet", orchid);
        expect(namedFn).toHaveBeenCalledWith(orchid);
        expect(defaultFn).not.toHaveBeenCalled();

        vi.doUnmock("/fake/config/hooks/startup.ts");
    });

    it("should not throw when hook module cannot be found", async () => {
        await runStartupHooks("./nonexistent/hook.ts", orchid);
        // warns but does not throw
    });

    it("should not throw when named export does not exist", async () => {
        vi.doMock("/fake/config/hooks/empty.ts", () => ({ default: "not-a-function" }));

        await runStartupHooks("./hooks/empty.ts#missing", orchid);
        // hook is undefined → typeof !== "function" → silently skipped

        vi.doUnmock("/fake/config/hooks/empty.ts");
    });
});
