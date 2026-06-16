import { describe, it, expect } from "vitest";
import {
    OrchidConfigError,
    ConfigLoadError,
    ConfigValidationError,
    AgentNotFoundError,
} from "../../src/config/errors.js";

describe("Config Errors", () => {
    it("OrchidConfigError extends Error", () => {
        const err = new OrchidConfigError("test error");
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(OrchidConfigError);
        expect(err.name).toBe("OrchidConfigError");
        expect(err.message).toBe("test error");
    });

    it("ConfigLoadError includes path", () => {
        const err = new ConfigLoadError("not found", "/path/to/config.yaml");
        expect(err).toBeInstanceOf(ConfigLoadError);
        expect(err).toBeInstanceOf(OrchidConfigError);
        expect(err.path).toBe("/path/to/config.yaml");
    });

    it("ConfigValidationError includes zod errors", () => {
        const zodErrors = [{ path: "agents.test.prompt", message: "Required" }];
        const err = new ConfigValidationError("validation failed", zodErrors);
        expect(err).toBeInstanceOf(ConfigValidationError);
        expect(err.zodErrors).toHaveLength(1);
        expect(err.zodErrors[0].path).toBe("agents.test.prompt");
    });

    it("AgentNotFoundError includes agent name", () => {
        const err = new AgentNotFoundError("missing_agent");
        expect(err).toBeInstanceOf(AgentNotFoundError);
        expect(err.message).toContain("missing_agent");
    });
});
