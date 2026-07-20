import type { OrchidConfigStorage } from "./storage.js";

export async function buildConfigStorage(
    classPath: string,
    dsn: string,
): Promise<OrchidConfigStorage> {
    const mod = await import(classPath);
    const Cls = mod.default || mod[Object.keys(mod)[0]];

    if (!Cls) {
        throw new Error(`Cannot resolve class from '${classPath}'`);
    }

    const instance = new Cls(dsn);

    // Check if it has the required methods (duck typing)
    if (
        typeof instance.initDb !== "function" ||
        typeof instance.close !== "function" ||
        typeof instance.listConfigs !== "function"
    ) {
        throw new Error(`Class '${classPath}' does not implement OrchidConfigStorage interface`);
    }

    return instance as OrchidConfigStorage;
}
