import React, { useState, useEffect, useCallback } from 'react';
import { LocationDetails, SavedState, UIState } from "./types";
import { compressTrip, decompressTrip } from "./utils/shareUtils";
import { getPlaceDetails, generateItinerary, getSuggestedDestinations } from './services/geminiService';
import { PlaceCard } from './components/PlaceCard';
import { MapComponent } from './components/MapComponent';

const STORAGE_KEYS = {
  REF_INPUT: 'trip_master_ref_input',
  SAVED_STATE: 'trip_master_saved_state',
  UI_STATE: 'trip_master_ui_state'
};

const App: React.FC = () => {
  const [refInput, setRefInput] = useState(
    localStorage.getItem(STORAGE_KEYS.REF_INPUT) || 'Merlo, San Luis, Argentina'
  );

  const [savedState, setSavedState] = useState<SavedState>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SAVED_STATE);
    return saved ? JSON.parse(saved) : {
      referenceLocation: null,
      destinations: [],
      itinerary: '',
      sources: []
    };
  });

  const [uiState, setUiState] = useState<UIState>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.UI_STATE);
    const initialUI = saved ? JSON.parse(saved) : {};
    return {
      activeTab: (['map', 'destinations', 'itinerary'].includes(initialUI.activeTab) ? initialUI.activeTab : 'destinations') as any,
      isLoading: false,
      loadingMessage: { title: '', description: '' },
      candidates: [],
      isSelectingFor: null,
      currentAbortController: null,
      newPlaceInput: ''
    };
  });

  const [userPosition, setUserPosition] = useState<{ lat: number, lng: number } | null>(null);

  // Setup geolocation watcher for real-time tracking
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => console.log("Location info:", error.message),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleCancelRequest = () => {
    if (uiState.currentAbortController) {
      uiState.currentAbortController.abort();
      setUiState(prev => ({
        ...prev,
        currentAbortController: null,
        isLoading: false,
        loadingMessage: { title: '', description: '' }
      }));
    }
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REF_INPUT, refInput);
  }, [refInput]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SAVED_STATE, JSON.stringify(savedState));
  }, [savedState]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({
      activeTab: uiState.activeTab,
    }));
  }, [uiState.activeTab]);

  // --- EFFECT: URL Import ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedData = params.get('trip');
    if (sharedData) {
      const trip = decompressTrip(sharedData);
      if (trip && trip.destinations) {
        setSavedState(trip);
        window.history.replaceState({}, document.title, window.location.pathname);
        alert("¡Viaje importado con éxito!");
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
        const timeStr = durMin > 60
          ? `${Math.floor(durMin / 60)}h ${durMin % 60}m`
          : `${durMin}m`;
        return { distance: `${distKm} km`, duration: timeStr };
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
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta geolocalización");
      return;
    }

    setUiState(prev => ({
      ...prev,
      isLoading: true,
      loadingMessage: { title: 'Obteniendo Ubicación', description: 'Por favor, acepta el permiso de GPS en tu navegador si aparece.' }
    }));

    // Trigger explicit permission request
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      try {
        const details: LocationDetails = {
          name: "Tu ubicación actual",
          description: "Punto de referencia basado en tu GPS.",
          activities: [],
          coordinates: { lat: latitude, lng: longitude }
        };
        setSavedState(prev => ({ ...prev, referenceLocation: details }));
        if (savedState.destinations.length > 0) {
          const updated = await updateAllDistances(details, savedState.destinations);
          setSavedState(prev => ({ ...prev, destinations: updated }));
        }
        // Ensure userPosition is updated immediately
        setUserPosition({ lat: latitude, lng: longitude });
      } catch (error) {
        console.error("Error reverse geocoding", error);
      } finally {
        setUiState(prev => ({ ...prev, isLoading: false }));
      }
    }, (error) => {
      console.error("Error getting location", error);
      setUiState(prev => ({ ...prev, isLoading: false }));
      if (error.code === 1) {
        alert("Permiso de GPS denegado. Por favor, habilítalo en los ajustes de tu navegador.");
      } else {
        alert("No se pudo obtener tu ubicación actual.");
      }
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const handleSetReference = async () => {
    if (!refInput) return;
    const controller = new AbortController();
    setUiState(prev => ({
      ...prev,
      currentAbortController: controller,
      loadingMessage: {
        title: 'Buscando Punto Base',
        description: 'Identificando la ubicación de inicio y calculando distancias iniciales.'
      },
      isLoading: true
    }));
    try {
      const { candidates: results } = await getPlaceDetails(refInput, refInput, controller.signal);
      if (results.length === 1) {
        setSavedState(prev => ({ ...prev, referenceLocation: results[0] }));
        if (savedState.destinations.length > 0) {
          const updated = await updateAllDistances(results[0], savedState.destinations);
          setSavedState(prev => ({ ...prev, destinations: updated }));
        }
      } else if (results.length > 1) {
        setUiState(prev => ({ ...prev, candidates: results, isSelectingFor: 'reference' }));
      } else {
        alert("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (error: any) {
      if (error.message === 'Aborted') return;
      console.error(error);
      alert("Ocurrió un error en la búsqueda.");
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
    }
  };

  const handleShareTrip = () => {
    const encoded = compressTrip(savedState);
    const url = `${window.location.origin}${window.location.pathname}?trip=${encoded}`;
    navigator.clipboard.writeText(url).then(() => {
      alert("¡Link de viaje copiado al portapapeles! Compartilo con tu novia.");
    });
  };

  const handleAddDestination = (loc: LocationDetails) => {
    if (savedState.destinations.length >= 5) {
      alert("Has alcanzado el límite de 5 destinos de la versión gratuita. ¡Próximamente opción Premium!");
      return;
    }
    setSavedState(prev => ({
      ...prev,
      destinations: [...prev.destinations, loc]
    }));
  };

  const handleAddDestinationFromInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uiState.newPlaceInput || !savedState.referenceLocation) return;
    const controller = new AbortController();
    setUiState(prev => ({
      ...prev,
      currentAbortController: controller,
      loadingMessage: {
        title: 'Buscando Destino',
        description: `Buscando "${prev.newPlaceInput}" cerca de ${savedState.referenceLocation?.name.split(',')[0]}...`
      },
      isLoading: true
    }));
    try {
      const { candidates: results } = await getPlaceDetails(uiState.newPlaceInput, savedState.referenceLocation.name, controller.signal);
      if (results.length === 1) {
        let details = results[0];
        if (details.coordinates && savedState.referenceLocation.coordinates) {
          const stats = await getRouteStats(savedState.referenceLocation.coordinates, details.coordinates);
          details = { ...details, distanceFromRef: stats?.distance, travelTime: stats?.duration };
        }
        handleAddDestination(details);
        setUiState(prev => ({ ...prev, newPlaceInput: '' }));
      } else if (results.length > 1) {
        const candidatesWithStats = await Promise.all(results.map(async (cand) => {
          if (cand.coordinates && savedState.referenceLocation?.coordinates) {
            const stats = await getRouteStats(savedState.referenceLocation.coordinates, cand.coordinates);
            return { ...cand, distanceFromRef: stats?.distance, travelTime: stats?.duration };
          }
          return cand;
        }));
        setUiState(prev => ({ ...prev, candidates: candidatesWithStats, isSelectingFor: 'destination' }));
      } else {
        alert("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (error: any) {
      if (error.message === 'Aborted') return;
      console.error(error);
      alert("Ocurrió un error en la búsqueda.");
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
    }
  };

  const selectCandidate = async (candidate: LocationDetails) => {
    if (uiState.isSelectingFor === 'reference') {
      setSavedState(prev => ({ ...prev, referenceLocation: candidate }));
      if (savedState.destinations.length > 0) {
        const controller = new AbortController();
        setUiState(prev => ({
          ...prev,
          currentAbortController: controller,
          loadingMessage: {
            title: 'Actualizando Rutas',
            description: 'Recalculando todas las distancias desde tu nueva ubicación base.'
          },
          isLoading: true
        }));
        const updated = await updateAllDistances(candidate, savedState.destinations);
        setSavedState(prev => ({ ...prev, destinations: updated }));
        setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
      }
    } else if (uiState.isSelectingFor === 'destination') {
      handleAddDestination(candidate);
      setUiState(prev => ({ ...prev, newPlaceInput: '' }));
    }
    setUiState(prev => ({ ...prev, candidates: [], isSelectingFor: null }));
  };

  const removeDestination = (name: string) => {
    setSavedState(prev => ({
      ...prev,
      destinations: prev.destinations.filter(d => d.name !== name)
    }));
  };

  const clearAllData = () => {
    if (confirm("¿Estás seguro de que quieres borrar todos los datos del viaje?")) {
      setSavedState({
        referenceLocation: null,
        destinations: [],
        itinerary: '',
        sources: []
      });
      setUiState(prev => ({ ...prev, activeTab: 'destinations' }));
      localStorage.removeItem(STORAGE_KEYS.SAVED_STATE);
      localStorage.removeItem(STORAGE_KEYS.UI_STATE);
      setRefInput('Merlo, San Luis, Argentina');
    }
  };

  useEffect(() => {
    const updateItinerary = async () => {
      if (!savedState.referenceLocation || savedState.destinations.length === 0) {
        setSavedState(prev => ({ ...prev, itinerary: '' }));
        return;
      }
      const controller = new AbortController();
      setUiState(prev => ({
        ...prev,
        currentAbortController: controller,
        loadingMessage: {
          title: 'Generando Itinerario',
          description: 'La IA está organizando tus destinos y creando una ruta lógica día por día.'
        },
        isLoading: true
      }));
      try {
        const { itinerary: text, sources: s } = await generateItinerary(
          savedState.referenceLocation.name,
          savedState.destinations.map(d => d.name),
          controller.signal
        );
        setSavedState(prev => ({
          ...prev,
          itinerary: text,
          sources: (() => {
            const combined = [...prev.sources, ...s];
            const unique = new Map();
            combined.forEach(item => { if (item.uri) unique.set(item.uri, item); });
            return Array.from(unique.values());
          })()
        }));
      } catch (error: any) {
        if (error.message === 'Aborted') return;
        console.error(error);
      } finally {
        setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
      }
    };
    const debounce = setTimeout(updateItinerary, 2000);
    return () => clearTimeout(debounce);
  }, [savedState.destinations, savedState.referenceLocation]);

  const handleSuggestDestinations = async () => {
    if (!savedState.referenceLocation) return;
    const controller = new AbortController();
    setUiState(prev => ({
      ...prev,
      currentAbortController: controller,
      loadingMessage: {
        title: 'Buscando Ideas con IA',
        description: `Analizando los mejores puntos de interés cerca de ${savedState.referenceLocation?.name.split(',')[0]}...`
      },
      isLoading: true
    }));
    try {
      const { candidates: results } = await getSuggestedDestinations(savedState.referenceLocation.name, controller.signal);
      if (results.length > 0) {
        const candidatesWithStats = await Promise.all(results.map(async (cand) => {
          if (cand.coordinates && savedState.referenceLocation?.coordinates) {
            const stats = await getRouteStats(savedState.referenceLocation.coordinates, cand.coordinates);
            return { ...cand, distanceFromRef: stats?.distance, travelTime: stats?.duration };
          }
          return cand;
        }));
        setUiState(prev => ({ ...prev, candidates: candidatesWithStats, isSelectingFor: 'destination' }));
      } else {
        alert("No pude encontrar sugerencias en este momento.");
      }
    } catch (error: any) {
      console.error(error);
      alert("Error al obtener sugerencias.");
    } finally {
      setUiState(prev => ({ ...prev, isLoading: false, currentAbortController: null }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100">
      {uiState.isLoading && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-white flex flex-col items-center max-w-sm w-full text-center">
            <div className="relative mb-8">
              <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">
              {uiState.loadingMessage.title || 'TripRoute IA Trabajando'}
            </h3>
            <p className="text-slate-500 text-sm font-medium mb-8 leading-relaxed">
              {uiState.loadingMessage.description || 'Estamos calculando las mejores rutas y lugares para tu viaje. Esto tomará solo unos segundos.'}
            </p>
            <button
              onClick={handleCancelRequest}
              className="px-6 py-3 rounded-2xl bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all border border-slate-200"
            >
              Cancelar Proceso
            </button>
          </div>
        </div>
      )}

      {uiState.candidates.length > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-slate-900/20 backdrop-blur-sm">
          <div className="bg-white rounded-[3rem] shadow-2xl border border-slate-100 w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-indigo-600">
              <div>
                <h3 className="text-2xl font-black text-white">¿Cuál es el lugar exacto?</h3>
                <p className="text-indigo-100 text-sm font-medium mt-1">Encontré varias opciones similares.</p>
              </div>
              <button
                onClick={() => setUiState(prev => ({ ...prev, candidates: [], isSelectingFor: null }))}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-4 bg-slate-50/50">
              {uiState.candidates.map((cand, i) => (
                <div
                  key={i}
                  className="p-6 bg-white rounded-3xl border border-slate-200 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-500/10 transition-all cursor-pointer group flex justify-between items-center"
                  onClick={() => selectCandidate(cand)}
                >
                  <div className="flex-1">
                    <h4 className="font-black text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">{cand.name}</h4>
                    <p className="text-slate-500 text-sm font-medium mt-1 line-clamp-2 leading-relaxed">{cand.description}</p>
                    {cand.distanceFromRef && (
                      <div className="mt-3 flex gap-4">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                          {cand.distanceFromRef}
                        </span>
                        {cand.travelTime && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {cand.travelTime}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ml-6 w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1800px] mx-auto px-6 py-10 md:py-16">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-indigo-600 rounded-[1.5rem] shadow-xl shadow-indigo-600/30">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">TripRoute <span className="text-indigo-600 italic">Master</span></h1>
            </div>
            <p className="text-lg text-slate-400 font-medium">Cálculos de ruta exactos con inteligencia geográfica.</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleShareTrip}
              className="px-6 py-4 bg-white text-indigo-600 border border-indigo-100 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2 shadow-lg shadow-indigo-100/50 hover:bg-indigo-50 transition-all active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Compartir Viaje
            </button>
            <nav className="flex p-2 bg-white rounded-3xl shadow-lg border border-slate-100 sticky top-4 z-[50]">
              {(['destinations', 'map', 'itinerary'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setUiState(prev => ({ ...prev, activeTab: tab }))}
                  className={`px-6 md:px-8 py-3 md:py-4 rounded-2xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${uiState.activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20 translate-y-[-2px]'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {tab === 'destinations' ? 'Destinos' : tab === 'map' ? 'Mapa' : 'Itinerario'}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <main className="grid grid-cols-1 xl:grid-cols-12 gap-10 items-start">
          <aside className="xl:col-span-4 space-y-10">
            <section className="bg-white p-8 md:p-10 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-200">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Punto de Referencia</h2>
                <div className="md:hidden">
                  <button
                    onClick={() => setUiState(prev => ({ ...prev, activeTab: 'map' }))}
                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  placeholder="Ej: Córdoba, Argentina"
                  className="flex-1 px-6 py-5 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 focus:bg-white transition-all outline-none font-bold text-slate-700 placeholder:text-slate-300"
                />
                <button
                  onClick={handleUseCurrentLocation}
                  className="p-5 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-md active:scale-95"
                  title="Usar ubicación actual (GPS)"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                <button
                  onClick={handleSetReference}
                  className="p-5 bg-slate-900 text-white rounded-2xl hover:bg-indigo-600 transition-all shadow-xl active:scale-95 group"
                >
                  <svg className="w-6 h-6 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>

              {savedState.referenceLocation && (
                <div className="p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100 animate-in slide-in-from-top-4">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-black text-indigo-900 text-lg leading-tight">{savedState.referenceLocation.name}</h4>
                    <button onClick={clearAllData} className="text-[10px] font-black uppercase text-rose-500 hover:underline">Reiniciar todo</button>
                  </div>
                  <p className="text-indigo-600/70 text-sm font-medium leading-relaxed">{savedState.referenceLocation.description}</p>
                </div>
              )}
            </section>

            {savedState.referenceLocation && (
              <section className="animate-in slide-in-from-bottom-8 duration-500">
                <div className="flex items-center justify-between mb-8 px-2">
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Tus Destinos {savedState.destinations.length > 0 && `(${savedState.destinations.length}/5)`}</h2>
                  <button
                    onClick={handleSuggestDestinations}
                    className="text-xs font-black text-indigo-600 hover:text-indigo-800 flex items-center gap-2 group p-2 bg-indigo-50 rounded-xl transition-all"
                  >
                    <svg className="w-4 h-4 group-hover:animate-sparkle" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                    </svg>
                    Ideas con IA
                  </button>
                </div>

                <form onSubmit={handleAddDestinationFromInput} className="mb-8 relative group">
                  <input
                    type="text"
                    value={uiState.newPlaceInput}
                    onChange={(e) => setUiState(prev => ({ ...prev, newPlaceInput: e.target.value }))}
                    placeholder="¿A dónde quieres ir?"
                    className="w-full pl-12 md:pl-14 pr-6 py-4 md:py-5 bg-white border-2 border-slate-100 rounded-[2rem] shadow-lg shadow-slate-200/50 focus:border-indigo-500 transition-all outline-none font-bold text-slate-700 placeholder:text-slate-300"
                  />
                  <div className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-500 transition-colors flex items-center gap-2">
                    {uiState.isLoading ? (
                      <div className="w-5 h-5 md:w-6 md:h-6 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" /></svg>
                    )}
                  </div>
                </form>

                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar overflow-x-hidden">
                  {savedState.destinations.length === 0 && !uiState.isLoading && (
                    <div className="py-12 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                      <p className="text-sm text-slate-400 font-medium">No hay destinos aún</p>
                    </div>
                  )}

                  {savedState.destinations.map((dest, idx) => (
                    <PlaceCard key={idx} place={dest} onRemove={removeDestination} />
                  ))}

                  {uiState.isLoading && uiState.newPlaceInput && (
                    <div className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/30 animate-pulse">
                      <div className="flex justify-between items-start mb-4">
                        <div className="h-4 w-24 bg-indigo-200 rounded-lg"></div>
                        <div className="h-4 w-4 bg-slate-200 rounded-lg"></div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-3 w-full bg-slate-100 rounded-lg"></div>
                        <div className="h-3 w-2/3 bg-slate-100 rounded-lg"></div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </aside>

          <div className="xl:col-span-8 space-y-8 min-w-0">
            <div className={`rounded-3xl overflow-hidden shadow-2xl shadow-indigo-100 border border-white ${uiState.activeTab !== 'map' ? 'hidden xl:block' : ''}`}>
              <MapComponent reference={savedState.referenceLocation} destinations={savedState.destinations} activeTab={uiState.activeTab} userPosition={userPosition} />
            </div>

            <section className={`bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-w-0 ${uiState.activeTab !== 'itinerary' ? 'hidden xl:block' : ''}`}>
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-black text-slate-900">Itinerario sugerido</h2>
                  {!uiState.isLoading && (savedState.itinerary || savedState.destinations.length > 0) && (
                    <span className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">
                      Ruta Optimizada
                    </span>
                  )}
                </div>
                {uiState.isLoading && (
                  <div className="flex items-center gap-2 text-indigo-600 text-sm font-bold animate-pulse">
                    <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></div>
                    Recalculando tiempos...
                  </div>
                )}
              </div>

              <div className="p-8 min-w-0">
                {savedState.itinerary ? (
                  <div className="prose prose-slate max-w-none break-words">
                    {savedState.itinerary.split('\n').map((line, i) => {
                      const renderLineWithLinks = (text: string) => {
                        let parts: (string | React.ReactNode)[] = [text];
                        savedState.destinations.forEach(dest => {
                          const newParts: (string | React.ReactNode)[] = [];
                          parts.forEach(part => {
                            if (typeof part === 'string') {
                              const regex = new RegExp(`(${dest.name})`, 'gi');
                              const splitPart = part.split(regex);
                              splitPart.forEach((subPart, index) => {
                                if (subPart.toLowerCase() === dest.name.toLowerCase()) {
                                  newParts.push(
                                    <button
                                      key={`${dest.name}-${index}`}
                                      onClick={() => setUiState(prev => ({ ...prev, activeTab: 'map' }))}
                                      className="text-indigo-600 font-bold hover:underline"
                                    >
                                      {subPart}
                                    </button>
                                  );
                                } else if (subPart) {
                                  newParts.push(subPart);
                                }
                              });
                            } else {
                              newParts.push(part);
                            }
                          });
                          parts = newParts;
                        });
                        return parts;
                      };

                      if (line.trim().startsWith('#') || line.trim().startsWith('Día')) {
                        return <h3 key={i} className="text-xl font-black mt-8 mb-4 text-slate-900 border-l-4 border-indigo-500 pl-4">{renderLineWithLinks(line.replace(/^#+\s*/, ''))}</h3>;
                      }
                      if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
                        return (
                          <div key={i} className="flex gap-3 mb-3 items-start group">
                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 group-hover:scale-150 transition-transform"></div>
                            <p className="text-slate-600 font-medium leading-relaxed m-0">{renderLineWithLinks(line.substring(1).trim())}</p>
                          </div>
                        );
                      }
                      return line.trim() ? <p key={i} className="mb-6 text-slate-500 leading-relaxed text-lg">{renderLineWithLinks(line)}</p> : null;
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                    <div className="w-24 h-24 mb-6 opacity-10">
                      <svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" /></svg>
                    </div>
                    <p className="text-lg font-bold">Planifica tus vacaciones basándote en tiempos reales de viaje</p>
                  </div>
                )}
              </div>
            </section>

            {savedState.sources.length > 0 && false && (
              <footer className="pb-10">
                <div className="flex flex-wrap gap-2">
                  {savedState.sources.map((source, idx) => (
                    <a
                      key={idx}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white/50 px-4 py-2 rounded-2xl border border-slate-200 text-xs text-indigo-500 font-bold hover:bg-white hover:shadow-md transition-all inline-flex items-center gap-2"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
                      {source.title || "Info"}
                    </a>
                  ))}
                </div>
              </footer>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
