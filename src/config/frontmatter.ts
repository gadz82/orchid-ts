import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface MarkdownFile {
    frontmatter: Record<string, unknown>;
    body: string;
    path: string;
    sha256: string;
}

export function computeSha256(content: Buffer | Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}

export function parseFrontmatter(text: string): {
    frontmatter: Record<string, unknown>;
    body: string;
} {
    // Strip BOM
    if (text.startsWith("\ufeff")) {
        text = text.slice(1);
    }

    // Normalize line endings
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    if (!text.startsWith("---\n")) {
        return { frontmatter: {}, body: text.trim() };
    }

    // Skip the opening delimiter
    const openingEnd = text.indexOf("\n") + 1;
    const rest = text.slice(openingEnd);

    // Empty frontmatter: after opening, rest starts with ---
    if (rest.startsWith("---\n")) {
        return { frontmatter: {}, body: rest.slice(4).trim() };
    }
    if (rest.trimEnd() === "---") {
        return { frontmatter: {}, body: "" };
    }

    const delimIdx = rest.indexOf("\n---");
    if (delimIdx === -1) {
        return { frontmatter: {}, body: text.trim() };
    }

    const fmText = rest.slice(0, delimIdx);
    // Body starts after the \n--- delimiter
    let body = rest.slice(delimIdx + 4);
    // Strip leading newline after ---
    if (body.startsWith("\n")) {
        body = body.slice(1);
    }
    body = body.trim();

    if (!fmText.trim()) {
        return { frontmatter: {}, body };
    }

    try {
        const parsed = parseYaml(fmText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return { frontmatter: {}, body };
        }
        return { frontmatter: parsed as Record<string, unknown>, body };
    } catch {
        return { frontmatter: {}, body };
    }
}

export function loadMarkdownFile(path: string): MarkdownFile {
    const resolved = resolve(path);
    const rawBytes = readFileSync(resolved);
    const rawText = rawBytes.toString("utf-8");
    const { frontmatter, body } = parseFrontmatter(rawText);
    const sha256 = computeSha256(rawBytes);

    return { frontmatter, body, path: resolved, sha256 };
}
