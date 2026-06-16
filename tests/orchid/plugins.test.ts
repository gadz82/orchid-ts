import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

vi.mock("node:fs", () => ({
    existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
    readdir: vi.fn(),
}));

import { discoverPlugins } from "../../src/orchid/plugins.js";

function dirent(name: string, isDir = true) {
    return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isSymbolicLink: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        parentPath: "/fake/node_modules",
        path: `/fake/node_modules/${name}`,
    };
}

describe("discoverPlugins", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns an array", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockResolvedValue([]);
        const result = await discoverPlugins("/fake/node_modules");
        expect(Array.isArray(result)).toBe(true);
    });

    it("returns empty array when node_modules does not exist", async () => {
        vi.mocked(existsSync).mockReturnValue(false);
        const result = await discoverPlugins("/missing/node_modules");
        expect(result).toEqual([]);
    });

    it("returns empty array when readdir throws", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockRejectedValue(new Error("access denied"));
        const result = await discoverPlugins("/fake");
        expect(result).toEqual([]);
    });

    it("finds orchid- prefixed packages", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockResolvedValue([
            dirent("orchid-mcp"),
            dirent("orchid-extra"),
            dirent("lodash", false),
            dirent("express", true),
        ] as any);
        const result = await discoverPlugins("/fake/node_modules");
        expect(result).toHaveLength(2);
        expect(result.map((p) => p.name)).toEqual(["orchid-mcp", "orchid-extra"]);
    });

    it("filters non-orchid packages", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockResolvedValue([
            dirent("react"),
            dirent("typescript"),
            dirent("orchid-myplugin"),
            dirent("orchid-auth"),
            dirent("lodash", false),
        ] as any);
        const result = await discoverPlugins("/fake/node_modules");
        const names = result.map((p) => p.name);
        expect(names).toEqual(["orchid-myplugin", "orchid-auth"]);
        expect(names).not.toContain("react");
        expect(names).not.toContain("typescript");
    });

    it("includes path in returned entries", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockResolvedValue([dirent("orchid-mcp")] as any);
        const result = await discoverPlugins("/custom/base/node_modules");
        expect(result[0].path).toBe("/custom/base/node_modules/orchid-mcp");
    });

    it("handles empty node_modules gracefully", async () => {
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readdir).mockResolvedValue([]);
        const result = await discoverPlugins();
        expect(result).toEqual([]);
    });
});
