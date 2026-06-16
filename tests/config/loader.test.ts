import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/loader.js";
import { ConfigLoadError, ConfigValidationError } from "../../src/config/errors.js";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orchid-config-test-"));
});

afterEach(() => {
    if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true });
    }
});

describe("Config Loader", () => {
    it("loads a minimal agents.yaml", () => {
        const yaml = `
agents:
  test:
    description: A test agent
    prompt: Be helpful
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        const config = loadConfig(path);
        expect(config.agents.test.name).toBe("test");
        expect(config.agents.test.description).toBe("A test agent");
        expect(config.agents.test.prompt).toBe("Be helpful");
        expect(config.version).toBe("1");
    });

    it("loads agents.yaml with supervisor config", () => {
        const yaml = `
supervisor:
  assistantName: Orchid
  historyMaxTurns: 30
agents:
  worker:
    description: Worker agent
    prompt: Do work
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        const config = loadConfig(path);
        expect(config.supervisor.assistantName).toBe("Orchid");
        expect(config.supervisor.historyMaxTurns).toBe(30);
    });

    it("throws ConfigLoadError for missing file", () => {
        expect(() => loadConfig("/nonexistent/agents.yaml")).toThrow(ConfigLoadError);
    });

    it("throws ConfigValidationError for invalid config", () => {
        const yaml = `
agents:
  test:
    description:
    prompt:
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });

    it("interpolates environment variables", () => {
        process.env.TEST_API_KEY = "secret-123";
        process.env.TEST_MODEL = "gemini/flash";

        const yaml = `
agents:
  worker:
    description: Worker with \${TEST_API_KEY}
    prompt: Use model \${TEST_MODEL}
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        try {
            const config = loadConfig(path);
            expect(config.agents.worker.description).toContain("secret-123");
            expect(config.agents.worker.prompt).toContain("gemini/flash");
        } finally {
            delete process.env.TEST_API_KEY;
            delete process.env.TEST_MODEL;
        }
    });

    it("throws when env variable is missing", () => {
        const yaml = `
agents:
  worker:
    description: \${MISSING_VAR}
    prompt: test
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        expect(() => loadConfig(path)).toThrow("MISSING_VAR");
    });

    it("loads config with defaults", () => {
        const yaml = `
defaults:
  llm:
    model: openai/gpt-4o
  cacheEnabled: true
agents:
  chat:
    description: Chat agent
    prompt: Chat
`;
        const path = join(tmpDir, "agents.yaml");
        writeFileSync(path, yaml);

        const config = loadConfig(path);
        // After buildAgentsConfig applies defaults, the agent inherits the LLM
        expect(config.agents.chat.name).toBe("chat");
    });
});
