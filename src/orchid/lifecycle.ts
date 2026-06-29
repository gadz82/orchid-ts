export type StartupHook = (orchid: any) => Promise<void>;

export async function runStartupHooks(hookPath: string, orchid: any): Promise<void> {
    if (!hookPath) return;
    try {
        const { pathToFileURL } = await import("node:url");
        const { resolve } = await import("node:path");

        let resolvedPath = hookPath;
        if (hookPath.startsWith(".")) {
            const configDir = orchid?.runtime?.configDir as string | undefined;
            const baseDir = configDir && resolve(configDir) !== resolve(process.cwd())
                ? configDir
                : process.cwd();
            resolvedPath = pathToFileURL(resolve(baseDir, hookPath)).href;
        }

        const mod = await import(resolvedPath);
        const hook: StartupHook = mod.default ?? mod.startupHook ?? mod;
        if (typeof hook === "function") {
            await hook(orchid);
        }
    } catch (e) {
        console.warn(`Startup hook '${hookPath}' failed: ${String(e)}`);
    }
}
