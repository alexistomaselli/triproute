import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { loadTrips, deleteTrip } from '../services/dbService';
import { ConfirmModal } from './ConfirmModal';

interface TripListModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTrip: (tripId: string) => void;
}

export const TripListModal: React.FC<TripListModalProps> = ({ isOpen, onClose, onSelectTrip }) => {
    const { user } = useAuth();
    const [trips, setTrips] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [tripToDelete, setTripToDelete] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && user) {
            load();
        }
    }, [isOpen, user]);

    const load = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const data = await loadTrips(user.id);
            setTrips(data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setTripToDelete(id);
    };

    const confirmDelete = async () => {
        if (!tripToDelete) return;
        await deleteTrip(tripToDelete);
        setTripToDelete(null);
        load();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-indigo-600 text-white">
                    <h2 className="text-2xl font-black">Mis Viajes</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-all">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <ConfirmModal
                    isOpen={!!tripToDelete}
                    onClose={() => setTripToDelete(null)}
                    onConfirm={confirmDelete}
                    title="¿Eliminar este viaje?"
                    description="Esta acción borrará permanentemente el registro de tu aventura."
                    confirmText="Eliminar permanentemente"
                />

                <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50">
                    {loading ? (
                        <div className="flex justify-center p-10"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div></div>
                    ) : trips.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <p className="font-bold text-lg">No tienes viajes guardados aún.</p>
                            <p className="text-sm mt-2">¡Crea uno nuevo y guárdalo!</p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {trips.map((trip) => (
                                <div
                                    key={trip.id}
                                    onClick={() => onSelectTrip(trip.id)}
                                    className="bg-white p-6 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-lg transition-all cursor-pointer group flex justify-between items-center"
                                >
                                    <div>
                                        <h3 className="font-black text-slate-800 text-lg group-hover:text-indigo-600">{trip.name}</h3>
                                        <p className="text-slate-500 text-sm mt-1">
                                            {new Date(trip.updated_at).toLocaleDateString()} • {trip.base_location?.name || 'Sin origen'} • {trip.destinations?.[0]?.count ?? 0} destinos
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeleteClick(e, trip.id)}
                                        className="p-3 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
