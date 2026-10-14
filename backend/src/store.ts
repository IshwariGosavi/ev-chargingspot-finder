import { SEED_HUBS } from "./data.js";
import type { AvailabilityUpdate, Hub } from "./types.js";

type Listener = (update: AvailabilityUpdate) => void;

/**
 * In-memory hub store. It owns the live availability numbers and notifies
 * subscribers (the SSE endpoint) whenever one changes. Swap the internals for a
 * database or a charger-network feed without touching the HTTP layer.
 */
export class HubStore {
  private readonly hubs = new Map<string, Hub>();
  private readonly updatedAt = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(seed: Hub[]) {
    const now = new Date().toISOString();
    for (const hub of seed) {
      this.hubs.set(hub.id, { ...hub, connectors: [...hub.connectors] });
      this.updatedAt.set(hub.id, now);
    }
  }

  list(): Hub[] {
    return [...this.hubs.values()].map((h) => ({ ...h, connectors: [...h.connectors] }));
  }

  get(id: string): Hub | undefined {
    const hub = this.hubs.get(id);
    return hub ? { ...hub, connectors: [...hub.connectors] } : undefined;
  }

  snapshot(): AvailabilityUpdate[] {
    return [...this.hubs.values()].map((h) => ({
      id: h.id,
      availableSpots: h.availableSpots,
      updatedAt: this.updatedAt.get(h.id) ?? new Date().toISOString(),
    }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Sets a hub's free spots (clamped to 0..total) and notifies listeners if it changed. */
  setAvailability(id: string, availableSpots: number): AvailabilityUpdate | null {
    const hub = this.hubs.get(id);
    if (!hub) return null;
    const next = Math.min(hub.totalSpots, Math.max(0, Math.round(availableSpots)));
    if (next === hub.availableSpots) return null;

    hub.availableSpots = next;
    const update: AvailabilityUpdate = {
      id,
      availableSpots: next,
      updatedAt: new Date().toISOString(),
    };
    this.updatedAt.set(id, update.updatedAt);
    this.listeners.forEach((fn) => fn(update));
    return update;
  }

  /** Randomly nudges one hub's availability every tick to mimic real-world traffic. */
  startSimulation(intervalMs = 4000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const all = [...this.hubs.values()];
      const hub = all[Math.floor(Math.random() * all.length)];
      if (!hub) return;
      const delta = Math.random() < 0.5 ? -1 : 1;
      this.setAvailability(hub.id, hub.availableSpots + delta);
    }, intervalMs);
  }

  stopSimulation(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const hubStore = new HubStore(SEED_HUBS);
