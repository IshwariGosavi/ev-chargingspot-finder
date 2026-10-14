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

/** distanceKm is null when the caller did not supply a location. */
export interface HubWithDistance extends Hub {
  distanceKm: number | null;
}

export interface Coords {
  lat: number;
  lng: number;
}

export interface AvailabilityUpdate {
  id: string;
  availableSpots: number;
  updatedAt: string; // ISO timestamp
}
