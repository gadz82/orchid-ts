export async function loadOrchidConfig(configPath: string): Promise<any> {
    const { loadConfig } = await import("../config/loader.js");
    return await loadConfig(configPath);
}
