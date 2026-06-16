import type { OrchidAgent } from "../core/agent.js";

const registry: Map<string, new (...args: unknown[]) => OrchidAgent> = new Map();

export function registerAgentClass(
    name: string,
    cls: new (...args: unknown[]) => OrchidAgent,
): void {
    registry.set(name, cls);
}

export function clearRegistry(): void {
    registry.clear();
}

export async function getAgentClass(
    classPath: string | null,
): Promise<new (...args: unknown[]) => OrchidAgent> {
    if (classPath === null || classPath === undefined) {
        // When GenericAgent is available (Phase 3), import it here.
        // For now, throw a clear error.
        throw new Error(
            "GenericAgent not yet available — config/schema layer is Phase 2, " +
                "GenericAgent lands in Phase 3 (agents/). Pass an explicit classPath or " +
                "register a custom agent class via registerAgentClass().",
        );
    }

    // Try registry first (short names)
    const registered = registry.get(classPath);
    if (registered) return registered;

    // Dynamic import from dotted path (or node module path with # separator)
    try {
        // Support both dotted paths (myapp.agents.SupportAgent) and paths with #
        const parts = classPath.split("#");
        if (parts.length === 2) {
            // Module-style: @myorg/pkg#ExportName
            const mod = await import(parts[0]);
            const cls = mod[parts[1]];
            if (!cls) {
                throw new Error(`Module '${parts[0]}' has no export '${parts[1]}'`);
            }
            return cls as new (...args: unknown[]) => OrchidAgent;
        }

        // Dotted path: myapp.agents.SupportAgent
        const lastDot = classPath.lastIndexOf(".");
        const modulePath = classPath.slice(0, lastDot);
        const className = classPath.slice(lastDot + 1);

        const mod = await import(modulePath);
        const cls = mod[className];
        if (!cls) {
            throw new Error(`Module '${modulePath}' has no export '${className}'`);
        }
        return cls as new (...args: unknown[]) => OrchidAgent;
    } catch (err) {
        throw new Error(
            `Cannot resolve agent class '${classPath}'. ` +
                `Ensure it is a valid import path or a registered short name. ` +
                `Error: ${(err as Error).message}`,
        );
    }
}
