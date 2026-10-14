import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { haversineKm } from "./geo.js";
import { hubStore } from "./store.js";
const PORT = Number(process.env.PORT ?? 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend");
const app = express();
app.disable("x-powered-by");
/* ------------------------------------------------------------------ */
/* Query parsing helpers                                               */
/* ------------------------------------------------------------------ */
class BadRequest extends Error {
}
function parseNumber(value, name) {
    if (value === undefined || value === "")
        return undefined;
    if (typeof value !== "string")
        throw new BadRequest(`${name} must be a single number`);
    const n = Number(value);
    if (!Number.isFinite(n))
        throw new BadRequest(`${name} must be a number`);
    return n;
}
function parseLocation(query) {
    const lat = parseNumber(query.lat, "lat");
    const lng = parseNumber(query.lng, "lng");
    if (lat === undefined && lng === undefined)
        return null;
    if (lat === undefined || lng === undefined)
        throw new BadRequest("lat and lng must be provided together");
    if (lat < -90 || lat > 90)
        throw new BadRequest("lat must be between -90 and 90");
    if (lng < -180 || lng > 180)
        throw new BadRequest("lng must be between -180 and 180");
    return { lat, lng };
}
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", hubs: hubStore.list().length, time: new Date().toISOString() });
});
/**
 * GET /api/hubs
 *   lat, lng        user location (both or neither). Adds distanceKm and sorts nearest-first.
 *   radiusKm        only hubs within this distance (requires lat/lng)
 *   available=true  only hubs with at least one free spot
 *   minPowerKw      only hubs with max power >= this value
 *   q               case-insensitive match on name or address
 *   limit           max results (1-100)
 */
app.get("/api/hubs", (req, res) => {
    const location = parseLocation(req.query);
    const radiusKm = parseNumber(req.query.radiusKm, "radiusKm");
    const minPowerKw = parseNumber(req.query.minPowerKw, "minPowerKw");
    const limit = parseNumber(req.query.limit, "limit");
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const onlyAvailable = req.query.available === "true";
    if (radiusKm !== undefined && !location)
        throw new BadRequest("radiusKm requires lat and lng");
    if (radiusKm !== undefined && radiusKm <= 0)
        throw new BadRequest("radiusKm must be positive");
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        throw new BadRequest("limit must be an integer between 1 and 100");
    }
    let hubs = hubStore.list().map((hub) => ({
        ...hub,
        distanceKm: location ? round(haversineKm(location, hub)) : null,
    }));
    if (onlyAvailable)
        hubs = hubs.filter((h) => h.availableSpots > 0);
    if (minPowerKw !== undefined)
        hubs = hubs.filter((h) => h.maxPowerKw >= minPowerKw);
    if (q)
        hubs = hubs.filter((h) => `${h.name} ${h.address}`.toLowerCase().includes(q));
    if (radiusKm !== undefined)
        hubs = hubs.filter((h) => (h.distanceKm ?? Infinity) <= radiusKm);
    hubs.sort((a, b) => location ? (a.distanceKm ?? 0) - (b.distanceKm ?? 0) : a.name.localeCompare(b.name));
    if (limit !== undefined)
        hubs = hubs.slice(0, limit);
    res.json({ hubs, count: hubs.length, location, updatedAt: new Date().toISOString() });
});
/** GET /api/hubs/:id  (optionally with lat & lng for distance) */
app.get("/api/hubs/:id", (req, res) => {
    const hub = hubStore.get(req.params.id);
    if (!hub) {
        res.status(404).json({ error: `No hub with id "${req.params.id}"` });
        return;
    }
    const location = parseLocation(req.query);
    res.json({ ...hub, distanceKm: location ? round(haversineKm(location, hub)) : null });
});
/**
 * GET /api/events  (Server-Sent Events)
 *   "snapshot"      sent once on connect: availability for every hub
 *   "availability"  sent whenever a hub's free-spot count changes
 */
app.get("/api/events", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write("retry: 3000\n\n");
    send("snapshot", hubStore.snapshot());
    const unsubscribe = hubStore.subscribe((update) => send("availability", update));
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
    });
});
app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
});
/* ------------------------------------------------------------------ */
/* Static frontend                                                     */
/* ------------------------------------------------------------------ */
app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));
/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
    if (err instanceof BadRequest) {
        res.status(400).json({ error: err.message });
        return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
});
/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
hubStore.startSimulation(4000);
const server = app.listen(PORT, () => {
    console.log(`Plugged is running at http://localhost:${PORT}`);
});
function shutdown() {
    hubStore.stopSimulation();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
