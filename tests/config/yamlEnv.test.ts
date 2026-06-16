import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyYamlToEnv } from "../../src/config/yamlEnv.js";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orchid-yamlenv-test-"));
});

afterEach(() => {
    if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true });
    }
});

describe("YAML Env Bridge", () => {
    it("applies known keys to env", () => {
        // Clean any pre-existing vars
        delete process.env.LITELLM_MODEL;
        delete process.env.OPENAI_API_KEY;
        delete process.env.QDRANT_URL;

        const yaml = `
llm:
  model: gemini/gemini-flash
  openai_api_key: sk-test
rag:
  qdrant_url: http://localhost:6333
`;
        const path = join(tmpDir, "orchid.yml");
        writeFileSync(path, yaml);

        const applied = applyYamlToEnv(path);
        expect(applied).toBeGreaterThanOrEqual(2);
        expect(process.env.LITELLM_MODEL).toBe("gemini/gemini-flash");
        expect(process.env.OPENAI_API_KEY).toBe("sk-test");
        expect(process.env.QDRANT_URL).toBe("http://localhost:6333");

        // Cleanup
        delete process.env.LITELLM_MODEL;
        delete process.env.OPENAI_API_KEY;
        delete process.env.QDRANT_URL;
    });

    it("does not override existing env vars", () => {
        process.env.LITELLM_MODEL = "existing-model";

        const yaml = `
llm:
  model: new-model
`;
        const path = join(tmpDir, "orchid.yml");
        writeFileSync(path, yaml);

        const applied = applyYamlToEnv(path);
        expect(applied).toBe(0);
        expect(process.env.LITELLM_MODEL).toBe("existing-model");

        delete process.env.LITELLM_MODEL;
    });

    it("skips sections when requested", () => {
        delete process.env.CHAT_DB_DSN;

        const yaml = `
storage:
  dsn: postgresql://localhost/db
`;
        const path = join(tmpDir, "orchid.yml");
        writeFileSync(path, yaml);

        const applied = applyYamlToEnv(path, { skipSections: new Set(["storage"]) });
        expect(applied).toBe(0);
    });

    it("returns 0 for missing file", () => {
        const applied = applyYamlToEnv("/nonexistent/orchid.yml");
        expect(applied).toBe(0);
    });
});
