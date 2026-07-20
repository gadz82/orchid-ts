import { resolve } from "node:path";
import type { OrchidContentSource } from "../core/content.js";
import { LocalFileContentSource } from "./local.js";

const CONTENT_SOURCE_REGISTRY: Map<string, new (...args: any[]) => OrchidContentSource> = new Map();

export function registerContentSource(
    name: string,
    cls: new (...args: any[]) => OrchidContentSource,
): void {
    CONTENT_SOURCE_REGISTRY.set(name, cls);
}

export function buildContentSource(
    name: string,
    settings: Record<string, unknown>,
): OrchidContentSource {
    const cls = CONTENT_SOURCE_REGISTRY.get(name);
    if (!cls) {
        throw new Error(
            `Unknown content source '${name}'. Registered: ${[...CONTENT_SOURCE_REGISTRY.keys()].join(", ")}. ` +
            `Call registerContentSource('${name}', cls) before constructing Orchid.`,
        );
    }
    return new cls(settings);
}

registerContentSource("local", LocalFileContentSource as unknown as new (...args: any[]) => OrchidContentSource);

export function buildContentSourcesFromConfig(
    config: Array<Record<string, unknown>>,
    configDir?: string,
): OrchidContentSource[] {
    const sources: OrchidContentSource[] = [];

    for (const entry of config) {
        const entryCopy = { ...entry };
        const sourceName = (entryCopy.source as string) ?? "local";
        delete entryCopy.source;

        if (sourceName === "local" && entryCopy.path && configDir) {
            entryCopy.path = resolve(configDir, entryCopy.path as string);
        }

        try {
            const source = buildContentSource(sourceName, entryCopy);
            sources.push(source);
        } catch (err) {
            console.error("[ContentSources] Failed to build source '%s': %s", sourceName, err);
        }
    }

    return sources;
}

export function buildContentSourcesFromEnv(configDir?: string): OrchidContentSource[] | null {
    const envJson = process.env.CONTENT_SOURCES;
    console.info("[ContentSources] CONTENT_SOURCES env var: %s", envJson ? "present" : "missing");
    if (!envJson) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(envJson);
    } catch {
        console.warn("[ContentSources] CONTENT_SOURCES is not valid JSON — ignoring");
        return null;
    }

    if (!Array.isArray(parsed)) {
        console.warn("[ContentSources] CONTENT_SOURCES must be a JSON array — ignoring");
        return null;
    }

    console.info("[ContentSources] parsed %d content source config(s)", parsed.length);
    return buildContentSourcesFromConfig(parsed as Array<Record<string, unknown>>, configDir);
}
