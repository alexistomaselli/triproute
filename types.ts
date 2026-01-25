
export interface LocationDetails {
  name: string;
  description: string;
  activities: string[];
  distanceFromRef?: string;
  travelTime?: string;
  mapsUri?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface ItineraryDay {
  day: number;
  locations: string[];
  recommendation: string;
}

export interface AppState {
  referenceLocation: string;
  destinations: LocationDetails[];
  itinerary: string;
  isLoading: boolean;
  sources: GroundingSource[];
}
