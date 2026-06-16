export function buildVisibilityFilter(tenantKey: string): Record<string, unknown> {
    return { tenantKey };
}

export function applyVisibilityFilter<T extends { metadata?: Record<string, unknown> }>(
    items: T[],
    tenantKey: string,
): T[] {
    return items.filter((item) => {
        if (!item.metadata) return true;
        const itemTenant =
            item.metadata.tenantKey ?? item.metadata.tenant_key ?? item.metadata.tenant;
        if (itemTenant === undefined) return true;
        return itemTenant === tenantKey;
    });
}

export function scopedVisibilityFilter(
    tenantKey: string,
    additionalFilters: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        tenantKey,
        ...additionalFilters,
    };
}
