import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { LocationDetails, SavedState, UIState } from "./types";
import { compressTrip, decompressTrip } from "./utils/shareUtils";
import { getPlaceDetails, generateItinerary, getSuggestedDestinations } from './services/geminiService';
import { PlaceCard } from './components/PlaceCard';
import { MapComponent } from './components/MapComponent';
import { useAuth } from './AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { TripListModal } from './components/TripListModal';
import { SaveTripModal } from './components/SaveTripModal';
import { ConfirmModal } from './components/ConfirmModal';
import { saveTrip, updateTrip, loadTripDetails } from './services/dbService';
import { Toaster, toast } from 'sonner';
import { useParams, useNavigate, Routes, Route } from 'react-router-dom';

const STORAGE_KEYS = {
  REF_INPUT: 'trip_master_ref_input',
  SAVED_STATE: 'trip_master_saved_state'
};

const getCardinalDirection = (from: { lat: number, lng: number }, to: { lat: number, lng: number }) => {
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  let angle = Math.atan2(dLng, dLat) * 180 / Math.PI;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const index = Math.round(((angle %= 360) < 0 ? angle + 360 : angle) / 45) % 8;
  return directions[index];
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<PlannerPage />} />
      <Route path="/trips/:tripId" element={<PlannerPage />} />
    </Routes>
  );
};

const PlannerPage: React.FC = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();

  // App State
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [tripName, setTripName] = useState<string>("Nuevo Viaje");

  const [refInput, setRefInput] = useState("");

  const [savedState, setSavedState] = useState<SavedState>({
    referenceLocation: null,
    destinations: [],
    itinerary: '',
    sources: []
  });

  const [uiState, setUiState] = useState<UIState>({
    activeTab: 'map',
    isLoading: false,
    loadingMessage: { title: '', description: '' },
    candidates: [],
    isSelectingFor: null,
    currentAbortController: null,
    newPlaceInput: ''
  });

  const [userPosition, setUserPosition] = useState<{ lat: number, lng: number } | null>(null);
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isNewTripConfirmOpen, setIsNewTripConfirmOpen] = useState(false);

  const [refSuggestions, setRefSuggestions] = useState<LocationDetails[]>([]);
  const [showRefSuggestions, setShowRefSuggestions] = useState(false);

  // Load Google Maps Script
  useEffect(() => {
    // 1. Get the real key, handling both dev (.env) and prod (window var)
    let key = (import.meta as any).env.VITE_API_KEY;
    const runtimeKey = (window as any).VITE_API_KEY;

    if (runtimeKey &&
      runtimeKey !== "__VITE_API_KEY_PLACEHOLDER__" &&
      !runtimeKey.includes("PLACEHOLDER")) {
      key = runtimeKey;
    }

    if (!key) {
      console.warn("Google Maps: No API Key found.");
      return;
    }

    // Google Maps Loader Logic Removed - Using Nominatim/Gemini Hybrid
  }, []);



  const handleSelectSuggestion = async (candidate: LocationDetails) => {
    // 1. Set the text
    const fullName = `${candidate.name}, ${candidate.description || ''}`;
    setRefInput(fullName);
    setRefSuggestions([]);
    setShowRefSuggestions(false);

    // 2. Trigger the "Search" logic to get full details (coords) from Gemini
    // We treat this selection as if the user typed it and hit "Set Reference"
    // We can reuse handleSetReference but we need to pass the text or rely on state update.
    // State update hasn't happened yet for refInput in the closure, so we pass explicit text if we could, 
    // but handleSetReference reads from refInput state.
    // So we'll force the input and trigger the specific logic manually or wait for effect.
    // Cleaner: Execute the logic directly here.

    const controller = new AbortController();
    setUiState(prev => ({ ...prev, currentAbortController: controller, loadingMessage: { title: 'Consultando IA', description: 'Obteniendo detalles del lugar...' }, isLoading: true }));

    try {
      // Use the full text for better Gemini context
      const { candidates } = await getPlaceDetails(fullName, '');
      if (candidates.length > 0) {
        const bestMatch = candidates[0]; // Gemini usually gives best match first
        setSavedState(prev => ({ ...prev, referenceLocation: bestMatch }));

        if (savedState.destinations.length > 0) {
          const updated = await updateAllDistances(bestMatch, savedState.destinations);
          setSavedState(prev => ({ ...prev, destinations: updated }));
        }
        toast.success(`Ubicación establecida: ${bestMatch.name}`);
      } else {
        toast.warning("La IA no pudo encontrar coordenadas exactas para este lugar.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al obtener detalles.");
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
    }
  };

  // ... (Setup geolocation watcher effect, etc.)

  // ...

  // Setup geolocation watcher
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => setUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => console.log("Location info:", error.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Auto-save logic (Database)
  useEffect(() => {
    if (!user || !tripId || !savedState.referenceLocation) return;

    const timeoutId = setTimeout(async () => {
      try {
        await updateTrip(tripId, savedState);
        toast.info("Cambios guardados", {
          duration: 1000,
          icon: '💾'
        });
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [savedState, user, tripId]);

  // Load trip from URL or clear
  useEffect(() => {
    if (tripId) {
      if (tripId !== currentTripId) {
        loadTrip(tripId);
      }
    } else {
      setSavedState({
        referenceLocation: null,
        destinations: [],
        itinerary: '',
        sources: []
      });
      setCurrentTripId(null);
      setTripName("Nuevo Viaje");
      setRefInput("");
    }
  }, [tripId, user]);

  // Sync refInput to local storage for persistence during selection
  useEffect(() => {
    if (refInput) localStorage.setItem(STORAGE_KEYS.REF_INPUT, refInput);
  }, [refInput]);


  // URL Import
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedData = params.get('trip');
    if (sharedData) {
      const trip = decompressTrip(sharedData);
      if (trip && trip.destinations) {
        setSavedState(trip);
        window.history.replaceState({}, document.title, window.location.pathname);
        toast.dismiss();
        toast.success("¡Viaje importado con éxito!");
      }
    }
  }, []);

  const getRouteStats = async (start: { lat: number, lng: number }, end: { lat: number, lng: number }) => {
    try {
      const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`);
      const data = await resp.json();
      if (data.routes && data.routes[0]) {
        const route = data.routes[0];
        const distKm = (route.distance / 1000).toFixed(1);
        const durMin = Math.round(route.duration / 60);
        return { distance: `${distKm} km`, duration: durMin > 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin}m` };
      }
    } catch (e) {
      console.error("OSRM Error", e);
    }
    return null;
  };

  const updateAllDistances = async (base: LocationDetails, dests: LocationDetails[]) => {
    if (!base.coordinates) return dests;
    return await Promise.all(dests.map(async (d) => {
      if (d.coordinates) {
        const stats = await getRouteStats(base.coordinates!, d.coordinates);
        return { ...d, distanceFromRef: stats?.distance, travelTime: stats?.duration };
      }
      return d;
    }));
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error("Tu navegador no soporta geolocalización"); return; }
    const toastId = toast.loading("Obteniendo ubicación...");
    setUiState(prev => ({ ...prev, isLoading: true, loadingMessage: { title: 'Obteniendo Ubicación', description: 'Por favor, acepta el permiso de GPS.' } }));

    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const details: LocationDetails = {
          name: "Tu ubicación actual", description: "Punto de referencia basado en tu GPS.", activities: [],
          coordinates: { lat: position.coords.latitude, lng: position.coords.longitude }
        };
        setSavedState(prev => ({ ...prev, referenceLocation: details }));
        if (savedState.destinations.length > 0) {
          const updated = await updateAllDistances(details, savedState.destinations);
          setSavedState(prev => ({ ...prev, destinations: updated }));
        }
        setUserPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
        toast.dismiss(toastId);
        toast.success("Ubicación actualizada");
      } catch (e) {
        console.error(e);
        toast.dismiss(toastId);
        toast.error("Error al procesar la ubicación");
      } finally { setUiState(prev => ({ ...prev, isLoading: false })); }
    }, (err) => {
      setUiState(prev => ({ ...prev, isLoading: false }));
      toast.dismiss(toastId);
      toast.error("No se pudo obtener tu ubicación. Verifica los permisos.");
    }, { enableHighAccuracy: true });
  };

  const handleSetReference = async () => {
    if (!refInput) return;
    const controller = new AbortController();
    setUiState(prev => ({ ...prev, currentAbortController: controller, loadingMessage: { title: 'Buscando Punto Base', description: 'Identificando ubicación...' }, isLoading: true }));
    try {
      const { candidates: results } = await getPlaceDetails(refInput, refInput, undefined, controller.signal);

      // Always asking the user to confirm, even if only 1 result found
      if (results.length > 0) {
        setUiState(prev => ({ ...prev, candidates: results, isSelectingFor: 'reference' }));
        if (results.length === 1) {
          toast.info("Confirma si este es el lugar.");
        } else {
          toast.info("Múltiples opciones encontradas.");
        }
      } else {
        toast.warning("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (e: any) {
      if (e.message !== 'Aborted') toast.error("Ocurrió un error en la búsqueda.");
    } finally { setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null })); }
  };

  const handleLoadMoreOptions = async () => {
    const isReference = uiState.isSelectingFor === 'reference';
    const query = isReference ? refInput : uiState.newPlaceInput;

    if (!query) return;

    const currentNames = uiState.candidates.map(c => c.name);
    const controller = new AbortController();
    setUiState(prev => ({ ...prev, isLoading: true }));

    try {
      const { candidates: rawResults } = await getPlaceDetails(
        query,
        savedState.referenceLocation?.name || query,
        savedState.referenceLocation?.coordinates,
        controller.signal
      );

      if (rawResults.length > 0) {
        const newResultsWithStats = await Promise.all(rawResults.map(async (cand) => {
          if (cand.coordinates && savedState.referenceLocation?.coordinates) {
            const stats = await getRouteStats(savedState.referenceLocation.coordinates, cand.coordinates);
            return { ...cand, distanceFromRef: stats?.distance, travelTime: stats?.duration };
          }
          return cand;
        }));

        setUiState(prev => ({
          ...prev,
          candidates: [...prev.candidates, ...newResultsWithStats]
        }));
        toast.success(`Se encontraron ${newResultsWithStats.length} opciones más.`);
      } else {
        toast.info("No se encontraron más opciones diferentes.");
      }
    } catch (e: any) {
      if (e.message !== 'Aborted') {
        console.error(e);
        toast.error("Error al buscar más opciones.");
      }
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false }));
    }
  };


  const handleAddDestinationFromInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uiState.newPlaceInput || !savedState.referenceLocation) return;
    const controller = new AbortController();
    setUiState(prev => ({ ...prev, currentAbortController: controller, loadingMessage: { title: 'Buscando Destino', description: `Buscando "${prev.newPlaceInput}"...` }, isLoading: true }));
    try {
      const { candidates: results } = await getPlaceDetails(
        uiState.newPlaceInput,
        savedState.referenceLocation.name,
        savedState.referenceLocation.coordinates,
        controller.signal
      );

      if (results.length > 0) {
        // ALWAYS show candidates so the user can verify before adding
        const candidatesWithStats = await Promise.all(results.map(async (cand) => {
          let updated = { ...cand };
          if (cand.coordinates && savedState.referenceLocation?.coordinates) {
            const stats = await getRouteStats(savedState.referenceLocation.coordinates, cand.coordinates);
            const direction = getCardinalDirection(savedState.referenceLocation.coordinates, cand.coordinates);
            updated = { ...updated, distanceFromRef: `${stats?.distance || '?'} (${direction})`, travelTime: stats?.duration };
          }
          return updated;
        }));
        setUiState(prev => ({ ...prev, candidates: candidatesWithStats, isSelectingFor: 'destination' }));

        if (results.length === 1) {
          toast.info(`Se encontró "${results[0].name}". Confirma para agregar.`);
        } else {
          toast.info("Varios lugares coinciden. Selecciona el correcto.");
        }
      } else {
        toast.warning("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (e: any) {
      if (e.message !== 'Aborted') toast.error("Error al buscar el destino.");
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
    }
  };

  const selectCandidate = async (candidate: LocationDetails) => {
    if (uiState.isSelectingFor === 'reference') {
      setSavedState(prev => ({ ...prev, referenceLocation: candidate }));

      // If we are not in a trip, prompt to create one after selecting reference
      if (!tripId && user) {
        setTripName(`Viaje a ${candidate.name}`);
        setIsSaveModalOpen(true);
      }

      if (savedState.destinations.length > 0) {
        setUiState(prev => ({ ...prev, isLoading: true, loadingMessage: { title: 'Actualizando', description: 'Recalculando rutas...' } }));
        const updated = await updateAllDistances(candidate, savedState.destinations);
        setSavedState(prev => ({ ...prev, destinations: updated }));
        setUiState(prev => ({ ...prev, isLoading: false }));
      }
      toast.success("Punto de inicio establecido");
    } else {
      setSavedState(prev => ({ ...prev, destinations: [...prev.destinations, candidate] }));
      setUiState(prev => ({ ...prev, newPlaceInput: '' }));
      toast.success("Destino agregado");
    }
    setUiState(prev => ({ ...prev, candidates: [], isSelectingFor: null }));
  };

  const updateItinerary = useCallback(async () => {
    if (!savedState.referenceLocation || savedState.destinations.length === 0) {
      setSavedState(prev => ({ ...prev, itinerary: '' }));
      return;
    }
    const controller = new AbortController();
    setUiState(prev => ({ ...prev, currentAbortController: controller, loadingMessage: { title: 'Generando Itinerario', description: 'La IA está organizando tus destinos...' }, isLoading: true }));
    try {
      const { itinerary: text, sources: s } = await generateItinerary(savedState.referenceLocation.name, savedState.destinations.map(d => d.name), controller.signal);
      setSavedState(prev => ({ ...prev, itinerary: text, sources: s }));
    } catch (e: any) { if (e.message !== 'Aborted') console.error(e); } finally { setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null })); }
  }, [savedState.referenceLocation, savedState.destinations]);

  const handleSaveTrip = () => {
    if (!savedState.referenceLocation) return toast.warning("Debes definir un punto de inicio antes de guardar.");
    if (!user) return;

    if (!currentTripId) {
      setIsSaveModalOpen(true);
    } else {
      performSaveTrip(tripName);
    }
  };

  const performSaveTrip = async (name: string) => {
    setTripName(name);
    setIsSaveModalOpen(false);

    const promise = (async () => {
      if (tripId) {
        await updateTrip(tripId, savedState);
        return "¡Cambios guardados correctamente!";
      } else {
        const data = await saveTrip(user!.id, name, savedState);
        setCurrentTripId(data.id);
        navigate(`/trips/${data.id}`);
        return "¡Viaje creado exitosamente!";
      }
    })();

    toast.promise(promise, {
      loading: 'Guardando los detalles de tu aventura...',
      success: (data) => data,
      error: (err) => `Error al guardar: ${err.message}`,
    });
  };

  const loadTrip = async (id: string) => {
    if (id === currentTripId) return; // Already loaded

    setUiState(prev => ({ ...prev, isLoading: true, loadingMessage: { title: 'Cargando', description: 'Recuperando tu aventura...' } }));
    try {
      const tripData = await loadTripDetails(id);
      if (tripData) {
        setSavedState(tripData);
        setCurrentTripId(id);
        setIsTripModalOpen(false);
      } else {
        toast.error("No se encontró el viaje solicitado.");
        navigate("/");
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar el viaje.");
      navigate("/");
    } finally { setUiState(prev => ({ ...prev, isLoading: false })); }
  };

  const handleNewTrip = () => {
    setIsNewTripConfirmOpen(true);
  };

  const confirmNewTrip = () => {
    setSavedState({ referenceLocation: null, destinations: [], itinerary: '', sources: [] });
    setCurrentTripId(null);
    setTripName("Nuevo Viaje");
    setRefInput("");
    setIsNewTripConfirmOpen(false);
    navigate("/");
    toast.success("¡Lienzo en blanco! Empieza tu nueva aventura.");
  };

  const handleSuggest = async () => {
    if (!savedState.referenceLocation) return;
    setUiState(prev => ({ ...prev, isLoading: true, loadingMessage: { title: 'IA Pensando', description: 'Buscando joyas ocultas...' } }));
    try {
      const { candidates } = await getSuggestedDestinations(savedState.referenceLocation.name);
      setUiState(prev => ({ ...prev, candidates, isSelectingFor: 'destination' }));
      if (candidates.length > 0) toast.info("¡Sugerencias encontradas!");
      else toast.warning("No se encontraron sugerencias.");
    } catch (e) { console.error(e); toast.error("Error al obtener sugerencias."); } finally { setUiState(prev => ({ ...prev, isLoading: false })); }
  };

  if (authLoading) return null;
  if (!user) return <LoginScreen />;

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100 font-sans">
      <Toaster position="top-center" richColors closeButton />
      <TripListModal
        isOpen={isTripModalOpen}
        onClose={() => setIsTripModalOpen(false)}
        onSelectTrip={(id) => {
          setIsTripModalOpen(false);
          navigate(`/trips/${id}`);
        }}
      />
      <SaveTripModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={performSaveTrip}
        initialName={tripName}
        title={tripId ? "Renombrar Viaje" : "Configurar Nuevo Viaje"}
        description={tripId ? "Cambia el nombre de tu aventura actual." : "Asigna un nombre para empezar a guardar tu ruta."}
      />
      <ConfirmModal
        isOpen={isNewTripConfirmOpen}
        onClose={() => setIsNewTripConfirmOpen(false)}
        onConfirm={confirmNewTrip}
        title="¿Comenzar de nuevo?"
        description="Quiere crear un nuevo viaje? Se perderán los cambios no guardados."
        confirmText="Crear Nuevo"
      />

      {uiState.isLoading && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="font-black text-slate-800">{uiState.loadingMessage.title}</h3>
            <p className="text-slate-500 text-sm mt-1">{uiState.loadingMessage.description}</p>
          </div>
        </div>
      )}

      {/* Candidate Selection Modal */}
      {uiState.candidates.length > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="p-6 bg-indigo-600 flex justify-between items-center text-white shrink-0">
              <h3 className="font-bold text-xl">Selecciona una opción</h3>
              <button onClick={() => setUiState(prev => ({ ...prev, candidates: [] }))}><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="p-4 overflow-y-auto custom-scrollbar bg-slate-50 space-y-3 flex-1">
              {uiState.candidates.map((c, i) => (
                <div key={i} className="group bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-500 shadow-sm hover:shadow-md transition-all">
                  <div onClick={() => selectCandidate(c)} className="cursor-pointer">
                    <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      <ReactMarkdown components={{ p: 'span' }}>{c.name}</ReactMarkdown>
                    </h4>
                    <div className="text-xs text-slate-500 mt-1 markdown-content line-clamp-2">
                      <ReactMarkdown>{c.description}</ReactMarkdown>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
                    <div className="flex gap-2">
                      {c.distanceFromRef && <span className="text-[10px] bg-indigo-50 px-2 py-1 rounded-full font-black text-indigo-600 uppercase tabular-nums">{c.distanceFromRef}</span>}
                    </div>
                    {c.mapsUri && (
                      <a
                        href={c.mapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        Ver en el Mapa
                      </a>
                    )}
                  </div>
                </div>
              ))}

              {/* Load More Button */}
              <button
                onClick={handleLoadMoreOptions}
                disabled={uiState.isLoading}
                className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-xl hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 mt-2"
              >
                {uiState.isLoading ? (
                  <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                )}
                Buscar más opciones
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1920px] mx-auto px-4 md:px-8 py-6">
        {/* HEADER */}
        <header className="flex items-center justify-between mb-8 bg-white p-4 md:p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 leading-none">VoiA <span className="text-indigo-600 italic">Travel</span></h1>
              <p className="text-xs text-slate-400 font-bold tracking-wider mt-1 uppercase">Trip Planner AI</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex gap-2 mr-4">
              <button onClick={handleNewTrip} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">Nuevo</button>
              <button onClick={() => setIsTripModalOpen(true)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">Mis Viajes</button>
              <button onClick={handleSaveTrip} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                {tripId ? 'Guardar Cambios' : 'Guardar Viaje'}
              </button>
            </div>

            <div className="relative">
              <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} className="flex items-center gap-2 hover:bg-slate-50 p-1.5 rounded-full pr-3 transition-colors border border-transparent hover:border-slate-100">
                {user.user_metadata.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="User" className="w-9 h-9 rounded-full border border-slate-200" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold">{user.email?.[0].toUpperCase()}</div>
                )}
                <span className="text-xs font-bold text-slate-700 hidden sm:block max-w-[100px] truncate">{user.user_metadata.full_name || user.email?.split('@')[0]}</span>
              </button>
              {isUserMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-in slide-in-from-top-2">
                  <div className="md:hidden border-b border-slate-50 mb-2 pb-2">
                    <button onClick={() => { handleNewTrip(); setIsUserMenuOpen(false); }} className="w-full text-left px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Nuevo Viaje</button>
                    <button onClick={() => { setIsTripModalOpen(true); setIsUserMenuOpen(false); }} className="w-full text-left px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Mis Viajes</button>
                    <button onClick={() => { handleSaveTrip(); setIsUserMenuOpen(false); }} className="w-full text-left px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50">Guardar</button>
                  </div>
                  <button onClick={signOut} className="w-full text-left px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50">Cerrar Sesión</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

          {/* LEFT PANEL */}
          <div className="xl:col-span-4 space-y-6">
            {/* REFERENCE INPUT */}
            {/* REFERENCE INPUT */}
            <div className="bg-white p-6 rounded-[2rem] shadow-lg shadow-slate-200/50 border border-slate-100 relative z-20">
              <h2 className="text-xs font-black uppercase text-slate-400 mb-4 tracking-widest">Origen del Viaje</h2>
              <div className="flex gap-2 relative">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={refInput}
                    onChange={e => {
                      setRefInput(e.target.value);
                      setShowRefSuggestions(true);
                    }}
                    onFocus={() => setShowRefSuggestions(true)}
                    // OnBlur needs a delay or check relatedTarget to allow clicking the list
                    onBlur={() => setTimeout(() => setShowRefSuggestions(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSetReference(); // Trigger manual search via Gemini
                        setShowRefSuggestions(false);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
                    placeholder="¿Dónde empieza la aventura? (Ej: Obelisco)"
                  />
                  {/* Suggestions List */}
                  {showRefSuggestions && refSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 max-h-60 overflow-y-auto custom-scrollbar z-50 animate-in fade-in slide-in-from-top-2">
                      {refSuggestions.map((place, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectSuggestion(place)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex flex-col"
                        >
                          <span className="font-bold text-slate-800 text-sm">{place.name}</span>
                          <span className="text-xs text-slate-400 truncate w-full">{place.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={handleUseCurrentLocation} className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                <button onClick={handleSetReference} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-indigo-600 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></button>
              </div>
              {savedState.referenceLocation && (
                <div className="mt-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                  <h4 className="font-black text-indigo-900">{savedState.referenceLocation.name}</h4>
                  <p className="text-xs text-indigo-700/70 mt-1 line-clamp-2">{savedState.referenceLocation.description}</p>
                </div>
              )}
            </div>

            {/* DESTINATIONS INPUT */}
            {savedState.referenceLocation && (
              <div className="bg-white p-6 rounded-[2rem] shadow-lg shadow-slate-200/50 border border-slate-100 min-h-[50vh]">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xs font-black uppercase text-slate-400 tracking-widest">Destinos ({savedState.destinations.length})</h2>
                  <button onClick={handleSuggest} className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" /></svg> Sugerir con IA</button>
                </div>

                <form onSubmit={handleAddDestinationFromInput} className="relative mb-6">
                  <input
                    type="text" value={uiState.newPlaceInput} onChange={e => setUiState(prev => ({ ...prev, newPlaceInput: e.target.value }))}
                    placeholder="Agregar destino..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-bold focus:outline-none focus:border-indigo-500"
                  />
                  <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </form>

                <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {savedState.destinations.map((d, i) => (
                    <PlaceCard key={i} place={d} onRemove={(name) => setSavedState(prev => ({ ...prev, destinations: prev.destinations.filter(x => x.name !== name) }))} />
                  ))}
                  {savedState.destinations.length === 0 && <p className="text-center text-slate-400 text-xs py-8">Agrega lugares para armar tu ruta.</p>}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT PANEL (Map & Itinerary) */}
          <div className="xl:col-span-8 flex flex-col gap-6">
            {/* TABS (Mobile only mostly, but good for switching view) */}
            <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100 w-fit self-end xl:hidden">
              {(['map', 'itinerary'] as const).map(t => (
                <button key={t} onClick={() => setUiState(prev => ({ ...prev, activeTab: t as any }))} className={`px-4 py-2 text-xs font-bold rounded-lg ${uiState.activeTab === t ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>{t === 'map' ? 'Mapa' : 'Itinerario'}</button>
              ))}
            </div>

            {/* MAP */}
            <div className={`h-[500px] rounded-[2rem] overflow-hidden shadow-xl shadow-indigo-100 border border-white ${uiState.activeTab !== 'map' ? 'hidden xl:block' : ''}`}>
              <MapComponent reference={savedState.referenceLocation} destinations={savedState.destinations} activeTab='map' userPosition={userPosition} />
            </div>

            {/* ITINERARY */}
            <div className={`bg-white p-8 rounded-[2rem] shadow-lg border border-slate-100 min-h-[300px] ${uiState.activeTab !== 'itinerary' ? 'hidden xl:block' : ''}`}>
              <h2 className="text-xl font-black text-slate-900 mb-6">Itinerario del Viaje</h2>
              {savedState.itinerary ? (
                <div className="prose prose-slate max-w-none prose-sm">
                  <div className="whitespace-pre-line">{savedState.itinerary}</div>
                </div>
              ) : (
                <p className="text-slate-400 text-center italic">Agrega destinos para que la IA genere tu ruta óptima.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
