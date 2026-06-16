import { existsSync, Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface OrchidPlugin {
    name: string;
    path: string;
}

export async function discoverPlugins(baseDir?: string): Promise<OrchidPlugin[]> {
    const root = baseDir ?? join(process.cwd(), "node_modules");
    if (!existsSync(root)) return [];

    let entries: Dirent[];
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }

    const plugins: OrchidPlugin[] = [];
    for (const entry of entries) {
        if (
            entry.isDirectory() &&
            (entry.name.startsWith("orchid-") || entry.name.startsWith("@orchid-ai/"))
        ) {
            plugins.push({ name: entry.name, path: join(root, entry.name) });
        }
    }

    return plugins;
}
