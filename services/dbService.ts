
// Database Services for Trips

import { supabase } from '../supabaseClient';
import { LocationDetails, SavedState, GroundingSource } from '../types';

export const saveTrip = async (userId: string, tripName: string, state: SavedState) => {
    const { data, error } = await supabase
        .from('trips')
        .insert([
            {
                user_id: userId,
                name: tripName,
                base_location: state.referenceLocation,
                itinerary: state.itinerary,
                sources: state.sources
            }
        ])
        .select()
        .single();

    if (error) throw error;

    // Save destinations
    if (state.destinations.length > 0 && data) {
        const destinationsToInsert = state.destinations.map(d => ({
            trip_id: data.id,
            data: d
        }));

        const { error: destError } = await supabase
            .from('destinations')
            .insert(destinationsToInsert);

        if (destError) throw destError;
    }

    return data;
};

export const updateTrip = async (tripId: string, state: SavedState) => {
    // Update trip main info
    const { error } = await supabase
        .from('trips')
        .update({
            base_location: state.referenceLocation,
            itinerary: state.itinerary,
            sources: state.sources,
            updated_at: new Date()
        })
        .eq('id', tripId);

    if (error) throw error;

    // Sync destinations: simpler strategy is delete all and recreate for this MVP
    // Ideally, we would diff them, but full replace ensures consistency easily

    // 1. Delete existing
    const { error: delError } = await supabase
        .from('destinations')
        .delete()
        .eq('trip_id', tripId);

    if (delError) throw delError;

    // 2. Insert current
    if (state.destinations.length > 0) {
        const destinationsToInsert = state.destinations.map(d => ({
            trip_id: tripId,
            data: d
        }));

        const { error: destError } = await supabase
            .from('destinations')
            .insert(destinationsToInsert);

        if (destError) throw destError;
    }
};

export const loadTrips = async (userId: string) => {
    const { data, error } = await supabase
        .from('trips')
        .select('*, destinations(count)')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

    if (error) throw error;
    return data;
};

export const loadTripDetails = async (tripId: string): Promise<SavedState | null> => {
    const { data: trip, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

    if (error) return null;

    const { data: destinations, error: destError } = await supabase
        .from('destinations')
        .select('data')
        .eq('trip_id', tripId);

    if (destError) return null;

    return {
        referenceLocation: trip.base_location,
        destinations: destinations.map(d => d.data),
        itinerary: trip.itinerary,
        sources: trip.sources || []
    };
};

export const deleteTrip = async (tripId: string) => {
    const { error } = await supabase
        .from('trips')
        .delete()
        .eq('id', tripId);

    if (error) throw error;
};
