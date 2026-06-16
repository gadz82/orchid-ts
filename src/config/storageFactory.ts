import { OrchidConfigStorage } from "./storage.js";

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

    if (!(instance instanceof OrchidConfigStorage)) {
        throw new Error(`Class '${classPath}' is not a subclass of OrchidConfigStorage`);
    }

    return instance;
}
