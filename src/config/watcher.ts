import { existsSync } from "node:fs";
import type { OrchidAgentsConfig } from "./schema/agent.js";
import { computeSha256 } from "./frontmatter.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig as loadYamlConfig } from "./loader.js";

export interface OrchidConfigSnapshot {
    config: OrchidAgentsConfig;
    fileHashes: Record<string, string>;
    rootPath: string;
}

export abstract class OrchidConfigWatcherBase {
    protected snapshot: OrchidConfigSnapshot;

    constructor(
        initialConfig: OrchidAgentsConfig,
        initialHashes: Record<string, string>,
        rootPath: string,
    ) {
        this.snapshot = { config: initialConfig, fileHashes: { ...initialHashes }, rootPath };
    }

    abstract currentHashes(): Record<string, string>;
    abstract reload(): Promise<OrchidConfigSnapshot>;
    abstract reloadSingleAgent(name: string): Promise<OrchidConfigSnapshot | null>;

    hasChanges(): boolean {
        const current = this.currentHashes();
        if (!current || Object.keys(current).length === 0) return true;
        if (
            new Set(Object.keys(current)).size !==
            new Set(Object.keys(this.snapshot.fileHashes)).size
        ) {
            return true;
        }
        for (const [k, v] of Object.entries(current)) {
            if (this.snapshot.fileHashes[k] !== v) return true;
        }
        return false;
    }

    changedFiles(): string[] {
        const current = this.currentHashes();
        const changed: string[] = [];
        if (!current || Object.keys(current).length === 0) return changed;

        for (const [pathStr, newHash] of Object.entries(current)) {
            const oldHash = this.snapshot.fileHashes[pathStr];
            if (oldHash === undefined || oldHash !== newHash) {
                changed.push(pathStr);
            }
        }
        return changed;
    }

    async reloadIfChanged(): Promise<OrchidConfigSnapshot | null> {
        if (!this.hasChanges()) return null;
        return this.reload();
    }
}

export class OrchidYamlConfigWatcher extends OrchidConfigWatcherBase {
    private orchidYmlPath: string;
    private agentsYamlPath: string;

    constructor(orchidYmlPath: string, agentsYamlPath: string, initialConfig: OrchidAgentsConfig) {
        const orchidYml = resolve(orchidYmlPath);
        const agentsYaml = resolve(agentsYamlPath);
        const initialHashes: Record<string, string> = {};
        if (existsSync(orchidYml)) {
            initialHashes[orchidYml] = computeSha256(readFileSync(orchidYml));
        }
        if (existsSync(agentsYaml)) {
            initialHashes[agentsYaml] = computeSha256(readFileSync(agentsYaml));
        }
        super(initialConfig, initialHashes, agentsYaml);
        this.orchidYmlPath = orchidYml;
        this.agentsYamlPath = agentsYaml;
    }

    currentHashes(): Record<string, string> {
        const hashes: Record<string, string> = {};
        for (const pathStr of Object.keys(this.snapshot.fileHashes)) {
            if (existsSync(pathStr)) {
                hashes[pathStr] = computeSha256(readFileSync(pathStr));
            }
        }
        return hashes;
    }

    async reload(): Promise<OrchidConfigSnapshot> {
        const config = await loadYamlConfig(this.agentsYamlPath);

        const newHashes: Record<string, string> = {};
        if (existsSync(this.orchidYmlPath)) {
            newHashes[this.orchidYmlPath] = computeSha256(readFileSync(this.orchidYmlPath));
        }
        if (existsSync(this.agentsYamlPath)) {
            newHashes[this.agentsYamlPath] = computeSha256(readFileSync(this.agentsYamlPath));
        }

        this.snapshot = { config, fileHashes: newHashes, rootPath: this.agentsYamlPath };
        return this.snapshot;
    }

    async reloadSingleAgent(_name: string): Promise<OrchidConfigSnapshot | null> {
        // YAML is a single file — just reload everything
        if (!existsSync(this.agentsYamlPath)) return null;

        const newHash = computeSha256(readFileSync(this.agentsYamlPath));
        const oldHash = this.snapshot.fileHashes[this.agentsYamlPath];
        if (oldHash === newHash) return null;

        const newConfig = await loadYamlConfig(this.agentsYamlPath);
        const agents = (newConfig as unknown as Record<string, unknown>).agents as Record<
            string,
            unknown
        >;
        if (!(_name in agents)) return null;

        const oldAgent = (
            (this.snapshot.config as unknown as Record<string, unknown>).agents as Record<
                string,
                unknown
            >
        )?.[_name] as Record<string, unknown> | undefined;
        const newAgent = agents[_name];
        if (oldAgent && JSON.stringify(oldAgent) === JSON.stringify(newAgent)) {
            return null;
        }

        return this.reload();
    }
}
