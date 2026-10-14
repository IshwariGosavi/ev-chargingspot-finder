// Used until (or unless) the browser shares the device location.
export const DEFAULT_LOCATION = { lat: 19.076, lng: 72.8777 };
/** Hubs near a location, nearest first (the server computes distance). */
export async function fetchHubs(location, signal) {
    const params = new URLSearchParams({
        lat: String(location.lat),
        lng: String(location.lng),
    });
    const res = await fetch(`/api/hubs?${params}`, { signal });
    if (!res.ok) {
        let detail = "";
        try {
            detail = (await res.json()).error ?? "";
        }
        catch {
            /* body wasn't JSON */
        }
        throw new Error(detail || `Server responded with ${res.status}`);
    }
    const body = (await res.json());
    return body.hubs;
}
/**
 * Opens the server-sent-events stream. The browser reconnects automatically,
 * and every reconnect starts with a fresh "snapshot" event. Returns a close function.
 */
export function subscribeToAvailability(handlers) {
    const source = new EventSource("/api/events");
    source.addEventListener("open", handlers.onOpen);
    source.addEventListener("error", handlers.onError);
    source.addEventListener("snapshot", (e) => handlers.onSnapshot(JSON.parse(e.data)));
    source.addEventListener("availability", (e) => handlers.onUpdate(JSON.parse(e.data)));
    return () => source.close();
}
