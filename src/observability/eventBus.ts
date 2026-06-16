/** Simple in-process typed event bus — publish/subscribe for framework lifecycle events. */

export type EventListener = (event: string, data: Record<string, unknown>) => void;

export class OrchidEventBus {
    private listeners: Map<string, EventListener[]> = new Map();

    on(event: string, listener: EventListener): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(listener);
    }

    off(event: string, listener: EventListener): void {
        const lsts = this.listeners.get(event);
        if (!lsts) return;
        const idx = lsts.indexOf(listener);
        if (idx !== -1) {
            lsts.splice(idx, 1);
        }
        if (lsts.length === 0) {
            this.listeners.delete(event);
        }
    }

    emit(event: string, data: Record<string, unknown>): void {
        const lsts = this.listeners.get(event);
        if (lsts) {
            const snap = [...lsts];
            for (const fn of snap) {
                try {
                    fn(event, data);
                } catch {
                    // Swallow listener errors — one bad listener must not break others
                }
            }
        }
        const wild = this.listeners.get("*");
        if (wild) {
            const snap = [...wild];
            for (const fn of snap) {
                try {
                    fn(event, data);
                } catch {
                    // Swallow
                }
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}
