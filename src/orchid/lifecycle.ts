export type StartupHook = (orchid: any) => Promise<void>;

export async function runStartupHooks(hookPath: string, orchid: any): Promise<void> {
    if (!hookPath) return;
    try {
        const { pathToFileURL } = await import("node:url");
        const { resolve } = await import("node:path");

        // Split optional "#exportName" fragment from the path.
        const hashIdx = hookPath.indexOf("#");
        const filePart = hashIdx >= 0 ? hookPath.slice(0, hashIdx) : hookPath;
        const exportName = hashIdx >= 0 ? hookPath.slice(hashIdx + 1) : undefined;

        let resolvedPath = filePart;
        if (filePart.startsWith(".")) {
            const configDir = orchid?.runtime?.configDir as string | undefined;
            const baseDir = configDir && resolve(configDir) !== resolve(process.cwd())
                ? configDir
                : process.cwd();
            resolvedPath = pathToFileURL(resolve(baseDir, filePart)).href;
        }

        const mod = await import(resolvedPath);
        const hook: StartupHook = exportName
            ? mod[exportName]
            : (mod.default ?? mod.startupHook ?? mod);
        if (typeof hook === "function") {
            await hook(orchid);
        }
    } catch (e) {
        console.warn(`Startup hook '${hookPath}' failed: ${String(e)}`);
    }
}
