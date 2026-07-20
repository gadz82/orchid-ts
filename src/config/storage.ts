/**
 * OrchidConfigStorage — Abstract interface for agent configuration persistence.
 *
 * Allows integrators to manage agent configurations via a database instead of
 * (or alongside) YAML files. Configuration is declarative — controlled by the
 * `config_storage:` block in `agents.yaml`.
 *
 * At bootstrap, `Orchid.fromConfigPath()` builds the store, runs `initDb()`,
 * lists all DB configs, and merges them into `OrchidAgentsConfig` via
 * `mergeFromDb()`.
 */

export interface OrchidAgentConfigRecord {
    readonly name: string;
    readonly config: Record<string, unknown>;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface OrchidConfigStorage {
    /**
     * Initialize the storage backend (create tables, run migrations, etc.)
     */
    initDb(): Promise<void>;

    /**
     * Close the storage backend and release resources.
     */
    close(): Promise<void>;

    /**
     * List all agent configurations.
     */
    listConfigs(): Promise<OrchidAgentConfigRecord[]>;

    /**
     * Get a specific agent configuration by name.
     */
    getConfig(name: string): Promise<OrchidAgentConfigRecord | null>;

    /**
     * Insert or update an agent configuration.
     */
    upsertConfig(name: string, config: Record<string, unknown>): Promise<OrchidAgentConfigRecord>;

    /**
     * Partially update an agent configuration (deep merge).
     */
    patchConfig(name: string, patch: Record<string, unknown>): Promise<OrchidAgentConfigRecord | null>;

    /**
     * Delete an agent configuration.
     */
    deleteConfig(name: string): Promise<void>;
}
