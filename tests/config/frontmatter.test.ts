import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter, loadMarkdownFile, computeSha256 } from "../../src/config/frontmatter.js";

let tmpDir: string;

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "orchid-frontmatter-test-"));
});

afterEach(() => {
    if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true });
    }
});

describe("Frontmatter Parsing", () => {
    it("parses YAML frontmatter", () => {
        const result = parseFrontmatter(`---
title: Hello
author: Test
---
This is the body.`);
        expect(result.frontmatter).toEqual({ title: "Hello", author: "Test" });
        expect(result.body).toBe("This is the body.");
    });

    it("returns empty frontmatter for plain text", () => {
        const result = parseFrontmatter("Just plain text.");
        expect(result.frontmatter).toEqual({});
        expect(result.body).toBe("Just plain text.");
    });

    it("returns empty frontmatter for text starting with --- but no closing ---", () => {
        const result = parseFrontmatter("---\ntitle: Hello\nJust a broken header.");
        expect(result.frontmatter).toEqual({});
    });

    it("handles empty frontmatter block", () => {
        const result = parseFrontmatter("---\n---\nBody content.");
        expect(result.frontmatter).toEqual({});
        expect(result.body).toBe("Body content.");
    });

    it("strips BOM", () => {
        const bomText = "\ufeff---\ntitle: Test\n---\nBody.";
        const result = parseFrontmatter(bomText);
        expect(result.frontmatter).toEqual({ title: "Test" });
        expect(result.body).toBe("Body.");
    });

    it("loads markdown file", () => {
        const content = `---
title: Agent Config
description: A test agent
---
This is the agent prompt.`;
        const path = join(tmpDir, "agent.md");
        writeFileSync(path, content);

        const { frontmatter, body, sha256 } = loadMarkdownFile(path);
        expect(frontmatter.title).toBe("Agent Config");
        expect(frontmatter.description).toBe("A test agent");
        expect(body).toBe("This is the agent prompt.");
        expect(sha256).toHaveLength(64);
    });

    it("computeSha256 produces consistent hash", () => {
        const buf = Buffer.from("hello");
        const h1 = computeSha256(buf);
        const h2 = computeSha256(buf);
        expect(h1).toBe(h2);
        expect(h1).toHaveLength(64);
    });
});
