export type ConnectorType = "CCS2" | "Type 2" | "CHAdeMO";

export interface Hub {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  totalSpots: number;
  availableSpots: number;
  maxPowerKw: number;
  pricePerKwh: number; // INR
  connectors: ConnectorType[];
  open24h: boolean;
}

export interface HubWithDistance extends Hub {
  distanceKm: number;
}

export interface Coords {
  lat: number;
  lng: number;
}

/** Pushed by the server whenever a hub's free-spot count changes. */
export interface AvailabilityUpdate {
  id: string;
  availableSpots: number;
  updatedAt: string;
}

export type AvailabilityFilter = "all" | "available";
export type SpeedFilter = "any" | "fast";
export type LoadStatus = "loading" | "ready" | "error";

export interface State {
  hubs: HubWithDistance[];
  status: LoadStatus;
  error: string | null;
  live: boolean; // true while the realtime stream is connected
  userLocation: Coords;
  locationSource: "default" | "device";
  availability: AvailabilityFilter;
  speed: SpeedFilter;
  query: string;
  expandedId: string | null;
  lastUpdated: number;
}
