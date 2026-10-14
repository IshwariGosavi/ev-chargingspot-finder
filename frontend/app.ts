import { DEFAULT_LOCATION, fetchHubs, subscribeToAvailability } from "./api.js";
import type {
  AvailabilityFilter,
  AvailabilityUpdate,
  Hub,
  HubWithDistance,
  SpeedFilter,
  State,
} from "./types.js";

/* ------------------------------------------------------------------ */
/* Tiny reactive store: set() merges state and notifies subscribers.   */
/* ------------------------------------------------------------------ */

type Listener = (state: State) => void;

function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const store = createStore({
  hubs: [],
  status: "loading",
  error: null,
  live: false,
  userLocation: DEFAULT_LOCATION,
  locationSource: "default",
  availability: "all",
  speed: "any",
  query: "",
  expandedId: null,
  lastUpdated: Date.now(),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const FAST_KW = 50;

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

type Tone = "good" | "low" | "full";

function toneFor(hub: Hub): Tone {
  if (hub.availableSpots === 0) return "full";
  if (hub.availableSpots / hub.totalSpots <= 0.25 || hub.availableSpots <= 2) return "low";
  return "good";
}

const TONE_STYLES: Record<Tone, { text: string; bar: string; dot: string; label: string }> = {
  good: { text: "text-emerald-700", bar: "bg-emerald-500/80", dot: "bg-emerald-500", label: "Available" },
  low: { text: "text-amber-700", bar: "bg-amber-500/80", dot: "bg-amber-500", label: "Filling up" },
  full: { text: "text-stone-500", bar: "bg-stone-400/70", dot: "bg-stone-400", label: "Full" },
};

function visibleHubs(state: State): HubWithDistance[] {
  const q = state.query.trim().toLowerCase();
  return state.hubs
    .filter((h) => (state.availability === "available" ? h.availableSpots > 0 : true))
    .filter((h) => (state.speed === "fast" ? h.maxPowerKw >= FAST_KW : true))
    .filter((h) => (q ? `${h.name} ${h.address}`.toLowerCase().includes(q) : true))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/* ------------------------------------------------------------------ */
/* Data loading (REST) and live updates (SSE)                          */
/* ------------------------------------------------------------------ */

let inFlight: AbortController | null = null;

async function loadHubs(): Promise<void> {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  if (!store.get().hubs.length) store.set({ status: "loading", error: null });

  try {
    const hubs = await fetchHubs(store.get().userLocation, controller.signal);
    store.set({ hubs, status: "ready", error: null, lastUpdated: Date.now() });
  } catch (err) {
    if (controller.signal.aborted) return; // superseded by a newer request
    store.set({
      status: "error",
      error: err instanceof Error ? err.message : "Something went wrong",
    });
  }
}

function applyUpdates(updates: AvailabilityUpdate[]): void {
  const byId = new Map(updates.map((u) => [u.id, u]));
  let changed = false;
  const hubs = store.get().hubs.map((hub) => {
    const update = byId.get(hub.id);
    if (update && update.availableSpots !== hub.availableSpots) {
      changed = true;
      return { ...hub, availableSpots: update.availableSpots };
    }
    return hub;
  });
  if (changed) store.set({ hubs, lastUpdated: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const listEl = $("hub-list");
const summaryEl = $("summary");
const locationEl = $("location-label");
const updatedEl = $("updated-label");
const liveDotEl = $("live-dot");
const availabilityBtns = document.querySelectorAll<HTMLButtonElement>("[data-availability]");
const speedBtns = document.querySelectorAll<HTMLButtonElement>("[data-speed]");

function chipClasses(active: boolean): string {
  return active
    ? "bg-stone-800 text-white border-stone-800"
    : "bg-white text-stone-600 border-stone-200 hover:border-stone-300";
}

function renderCard(hub: HubWithDistance, expanded: boolean, nearest: boolean): string {
  const tone = toneFor(hub);
  const style = TONE_STYLES[tone];
  const pct = Math.round((hub.availableSpots / hub.totalSpots) * 100);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${hub.lat},${hub.lng}`;

  return `
    <li data-id="${escapeHtml(hub.id)}" class="hub-card rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
      <button type="button" data-toggle="${escapeHtml(hub.id)}" class="w-full text-left" aria-expanded="${expanded}">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="truncate text-base font-semibold text-stone-800">${escapeHtml(hub.name)}</h2>
              ${nearest ? '<span class="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">Nearest</span>' : ""}
            </div>
            <p class="mt-0.5 truncate text-sm text-stone-500">${escapeHtml(hub.address)}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm font-medium text-stone-800">${formatDistance(hub.distanceKm)}</p>
            <p class="text-xs text-stone-400">away</p>
          </div>
        </div>

        <div class="mt-4 flex items-end justify-between">
          <div>
            <p class="spots-value text-2xl font-semibold leading-none ${style.text}" data-spots="${hub.availableSpots}">
              ${hub.availableSpots}<span class="text-sm font-normal text-stone-400"> / ${hub.totalSpots} spots free</span>
            </p>
          </div>
          <span class="inline-flex items-center gap-1.5 text-xs ${style.text}">
            <span class="h-1.5 w-1.5 rounded-full ${style.dot}"></span>${style.label}
          </span>
        </div>

        <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100" role="progressbar"
             aria-valuemin="0" aria-valuemax="${hub.totalSpots}" aria-valuenow="${hub.availableSpots}"
             aria-label="Free spots">
          <div class="bar h-full rounded-full ${style.bar}" style="width:${pct}%"></div>
        </div>
      </button>

      <div class="details ${expanded ? "open" : ""}">
        <div class="overflow-hidden">
          <dl class="mt-4 grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 text-sm">
            <div><dt class="text-xs text-stone-400">Max power</dt><dd class="font-medium text-stone-700">${hub.maxPowerKw} kW</dd></div>
            <div><dt class="text-xs text-stone-400">Price</dt><dd class="font-medium text-stone-700">₹${hub.pricePerKwh}/kWh</dd></div>
            <div><dt class="text-xs text-stone-400">Hours</dt><dd class="font-medium text-stone-700">${hub.open24h ? "24 hours" : "6am – 11pm"}</dd></div>
          </dl>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-1.5">
              ${hub.connectors
                .map((c) => `<span class="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600">${escapeHtml(c)}</span>`)
                .join("")}
            </div>
            <a href="${directions}" target="_blank" rel="noopener noreferrer"
               class="rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
              Directions
            </a>
          </div>
        </div>
      </div>
    </li>`;
}

function renderSkeleton(): string {
  return Array.from({ length: 4 })
    .map(
      () => `
      <li class="rounded-2xl border border-stone-200 bg-white p-5">
        <div class="skeleton h-4 w-1/2 rounded"></div>
        <div class="skeleton mt-2 h-3 w-1/3 rounded"></div>
        <div class="skeleton mt-6 h-6 w-2/5 rounded"></div>
        <div class="skeleton mt-3 h-1.5 w-full rounded-full"></div>
      </li>`,
    )
    .join("");
}

/**
 * Cards only fade in when the set of hubs on screen changes (first load, a filter,
 * a new location). Live availability updates re-render quietly with no flash.
 */
let lastSignature = "";

function setList(html: string, signature: string): void {
  listEl.classList.toggle("list-enter", signature !== lastSignature);
  lastSignature = signature;
  listEl.innerHTML = html;
}

function render(state: State): void {
  // Filter chips
  availabilityBtns.forEach((b) => {
    const active = b.dataset.availability === state.availability;
    b.className = `chip rounded-full border px-3 py-1.5 text-sm transition-colors ${chipClasses(active)}`;
    b.setAttribute("aria-pressed", String(active));
  });
  speedBtns.forEach((b) => {
    const active = b.dataset.speed === state.speed;
    b.className = `chip rounded-full border px-3 py-1.5 text-sm transition-colors ${chipClasses(active)}`;
    b.setAttribute("aria-pressed", String(active));
  });

  locationEl.textContent =
    state.locationSource === "device" ? "Using your current location" : "Using default location";

  // Live connection indicator
  liveDotEl.className = `h-1.5 w-1.5 rounded-full ${state.live ? "live-dot bg-emerald-500" : "bg-stone-400"}`;
  updatedEl.textContent = state.live
    ? `Live · updated ${formatTime(state.lastUpdated)}`
    : state.status === "loading"
      ? "Connecting…"
      : "Reconnecting…";

  if (state.status === "loading") {
    setList(renderSkeleton(), "skeleton");
    summaryEl.textContent = "Finding charging hubs…";
    return;
  }

  if (state.status === "error") {
    summaryEl.textContent = "Couldn't load charging hubs";
    setList(
      `<li class="rounded-2xl border border-dashed border-stone-300 p-10 text-center">
        <p class="text-sm text-stone-600">Something went wrong reaching the server.</p>
        <p class="mt-1 text-xs text-stone-400">${escapeHtml(state.error ?? "")}</p>
        <button type="button" data-retry
          class="mt-4 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
          Try again
        </button>
      </li>`,
      "error",
    );
    return;
  }

  const hubs = visibleHubs(state);
  const free = hubs.reduce((sum, h) => sum + h.availableSpots, 0);
  summaryEl.textContent = hubs.length
    ? `${hubs.length} ${hubs.length === 1 ? "hub" : "hubs"} nearby · ${free} spots free`
    : "No hubs match your filters";

  if (!hubs.length) {
    setList(
      `<li class="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
        Nothing found. Try clearing the search or switching off a filter.
      </li>`,
      "empty",
    );
    return;
  }

  setList(
    hubs.map((h, i) => renderCard(h, h.id === state.expandedId, i === 0)).join(""),
    hubs.map((h) => h.id).join(","),
  );
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

availabilityBtns.forEach((b) =>
  b.addEventListener("click", () =>
    store.set({ availability: b.dataset.availability as AvailabilityFilter }),
  ),
);
speedBtns.forEach((b) =>
  b.addEventListener("click", () => store.set({ speed: b.dataset.speed as SpeedFilter })),
);

$<HTMLInputElement>("search").addEventListener("input", (e) =>
  store.set({ query: (e.target as HTMLInputElement).value }),
);

listEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  if (target.closest("[data-retry]")) {
    void loadHubs();
    return;
  }

  const trigger = target.closest<HTMLElement>("[data-toggle]");
  if (!trigger) return;
  const id = trigger.dataset.toggle ?? null;
  store.set({ expandedId: store.get().expandedId === id ? null : id });
});

$("locate").addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationEl.textContent = "Location not supported in this browser";
    return;
  }
  locationEl.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      store.set({
        userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        locationSource: "device",
      });
      void loadHubs(); // the server recalculates distances for the new location
    },
    () => {
      store.set({ locationSource: "default" });
      locationEl.textContent = "Couldn't get your location · using default";
    },
    { enableHighAccuracy: false, timeout: 8000 },
  );
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

store.subscribe(render);
render(store.get());

void loadHubs();

subscribeToAvailability({
  onOpen: () => store.set({ live: true }),
  onError: () => store.set({ live: false }),
  onSnapshot: (updates) => {
    applyUpdates(updates);
    store.set({ live: true });
  },
  onUpdate: (update) => applyUpdates([update]),
});
