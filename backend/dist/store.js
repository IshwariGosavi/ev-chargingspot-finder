import { SEED_HUBS } from "./data.js";
/**
 * In-memory hub store. It owns the live availability numbers and notifies
 * subscribers (the SSE endpoint) whenever one changes. Swap the internals for a
 * database or a charger-network feed without touching the HTTP layer.
 */
export class HubStore {
    hubs = new Map();
    updatedAt = new Map();
    listeners = new Set();
    timer = null;
    constructor(seed) {
        const now = new Date().toISOString();
        for (const hub of seed) {
            this.hubs.set(hub.id, { ...hub, connectors: [...hub.connectors] });
            this.updatedAt.set(hub.id, now);
        }
    }
    list() {
        return [...this.hubs.values()].map((h) => ({ ...h, connectors: [...h.connectors] }));
    }
    get(id) {
        const hub = this.hubs.get(id);
        return hub ? { ...hub, connectors: [...hub.connectors] } : undefined;
    }
    snapshot() {
        return [...this.hubs.values()].map((h) => ({
            id: h.id,
            availableSpots: h.availableSpots,
            updatedAt: this.updatedAt.get(h.id) ?? new Date().toISOString(),
        }));
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Sets a hub's free spots (clamped to 0..total) and notifies listeners if it changed. */
    setAvailability(id, availableSpots) {
        const hub = this.hubs.get(id);
        if (!hub)
            return null;
        const next = Math.min(hub.totalSpots, Math.max(0, Math.round(availableSpots)));
        if (next === hub.availableSpots)
            return null;
        hub.availableSpots = next;
        const update = {
            id,
            availableSpots: next,
            updatedAt: new Date().toISOString(),
        };
        this.updatedAt.set(id, update.updatedAt);
        this.listeners.forEach((fn) => fn(update));
        return update;
    }
    /** Randomly nudges one hub's availability every tick to mimic real-world traffic. */
    startSimulation(intervalMs = 4000) {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            const all = [...this.hubs.values()];
            const hub = all[Math.floor(Math.random() * all.length)];
            if (!hub)
                return;
            const delta = Math.random() < 0.5 ? -1 : 1;
            this.setAvailability(hub.id, hub.availableSpots + delta);
        }, intervalMs);
    }
    stopSimulation() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
}
export const hubStore = new HubStore(SEED_HUBS);
