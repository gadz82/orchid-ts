export type StartupHook = (orchid: any) => Promise<void>;

export async function runStartupHooks(hookPath: string, orchid: any): Promise<void> {
    if (!hookPath) return;
    try {
        const mod = await import(hookPath);
        const hook: StartupHook = mod.default ?? mod.startupHook ?? mod;
        if (typeof hook === "function") {
            await hook(orchid);
        }
    } catch (e) {
        console.warn(`Startup hook '${hookPath}' failed: ${String(e)}`);
    }
}
