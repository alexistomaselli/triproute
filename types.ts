
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

export interface SavedState {
  referenceLocation: LocationDetails | null;
  destinations: LocationDetails[];
  itinerary: string;
  sources: GroundingSource[];
}

export interface UIState {
  activeTab: 'map' | 'destinations' | 'itinerary';
  isLoading: boolean;
  loadingMessage: { title: string; description: string };
  candidates: LocationDetails[];
  isSelectingFor: 'reference' | 'destination' | null;
  currentAbortController: AbortController | null;
  newPlaceInput: string;
}
