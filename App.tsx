
import React, { useState, useEffect, useCallback } from 'react';
import { LocationDetails, GroundingSource } from './types';
import { getPlaceDetails, generateItinerary, getSuggestedDestinations } from './services/geminiService';
import { PlaceCard } from './components/PlaceCard';
import { MapComponent } from './components/MapComponent';

const STORAGE_KEYS = {
  REFERENCE: 'trip_master_ref',
  DESTINATIONS: 'trip_master_dests',
  ITINERARY: 'trip_master_itin',
  SOURCES: 'trip_master_sources',
  REF_INPUT: 'trip_master_ref_input',
  ACTIVE_TAB: 'trip_master_tab'
};

const App: React.FC = () => {
  // Lazy initialization to prevent race conditions on refresh
  const [refInput, setRefInput] = useState(() =>
    localStorage.getItem(STORAGE_KEYS.REF_INPUT) || 'Merlo, San Luis, Argentina'
  );

  const [referenceLocation, setReferenceLocation] = useState<LocationDetails | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.REFERENCE);
    return saved ? JSON.parse(saved) : null;
  });

  const [destinations, setDestinations] = useState<LocationDetails[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DESTINATIONS);
    return saved ? JSON.parse(saved) : [];
  });

  const [activeTab, setActiveTab] = useState<'map' | 'destinations' | 'itinerary'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) as any;
    return (saved && ['map', 'destinations', 'itinerary'].includes(saved)) ? saved : 'destinations';
  });

  const [itinerary, setItinerary] = useState(() =>
    localStorage.getItem(STORAGE_KEYS.ITINERARY) || ''
  );

  const [sources, setSources] = useState<GroundingSource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SOURCES);
    return saved ? JSON.parse(saved) : [];
  });

  const [userPosition, setUserPosition] = useState<{ lat: number, lng: number } | null>(null);
  const [newPlaceInput, setNewPlaceInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState({ title: '', description: '' });
  const [candidates, setCandidates] = useState<LocationDetails[]>([]);
  const [isSelectingFor, setIsSelectingFor] = useState<'reference' | 'destination' | null>(null);
  const [currentAbortController, setCurrentAbortController] = useState<AbortController | null>(null);

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
      (error) => console.error("Error watching location:", error),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleCancelRequest = () => {
    if (currentAbortController) {
      currentAbortController.abort();
      setCurrentAbortController(null);
      setIsLoading(false);
      setLoadingMessage({ title: '', description: '' });
    }
  };

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REF_INPUT, refInput);
  }, [refInput]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (referenceLocation) localStorage.setItem(STORAGE_KEYS.REFERENCE, JSON.stringify(referenceLocation));
    else localStorage.removeItem(STORAGE_KEYS.REFERENCE);
  }, [referenceLocation]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DESTINATIONS, JSON.stringify(destinations));
  }, [destinations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ITINERARY, itinerary);
  }, [itinerary]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
  }, [sources]);

  // Función para obtener distancia y tiempo reales via OSRM
  const getRouteStats = async (start: { lat: number, lng: number }, end: { lat: number, lng: number }) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.code === 'Ok' && data.routes.length > 0) {
        const route = data.routes[0];
        const distKm = (route.distance / 1000).toFixed(1);
        const timeMin = Math.round(route.duration / 60);
        return { distance: `${distKm} km`, duration: `${timeMin} min` };
      }
    } catch (e) { console.error(e); }
    return null;
  };

  const updateAllDistances = async (ref: LocationDetails, dests: LocationDetails[]) => {
    const updated = await Promise.all(dests.map(async (d) => {
      if (d.coordinates && ref.coordinates) {
        const stats = await getRouteStats(ref.coordinates, d.coordinates);
        return { ...d, distanceFromRef: stats?.distance, travelTime: stats?.duration };
      }
      return d;
    }));
    return updated;
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta geolocalización");
      return;
    }
    setIsLoading(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        const address = data.display_name || `${latitude}, ${longitude}`;
        setRefInput(address);
        const details: LocationDetails = {
          name: address,
          description: "Tu ubicación actual detectada vía GPS.",
          activities: [],
          coordinates: { lat: latitude, lng: longitude }
        };
        setReferenceLocation(details);
        if (destinations.length > 0) {
          const updated = await updateAllDistances(details, destinations);
          setDestinations(updated);
        }
      } catch (error) {
        console.error("Error reverse geocoding", error);
      } finally {
        setIsLoading(false);
      }
    }, (error) => {
      console.error("Error getting location", error);
      setIsLoading(false);
      alert("No se pudo obtener tu ubicación");
    });
  };

  const handleSetReference = async () => {
    if (!refInput) return;
    const controller = new AbortController();
    setCurrentAbortController(controller);
    setLoadingMessage({
      title: 'Buscando Punto Base',
      description: 'Identificando la ubicación de inicio y calculando distancias iniciales.'
    });
    setIsLoading(true);
    try {
      const { candidates: results } = await getPlaceDetails(refInput, refInput, controller.signal);
      if (results.length === 1) {
        setReferenceLocation(results[0]);
        if (destinations.length > 0) {
          const updated = await updateAllDistances(results[0], destinations);
          setDestinations(updated);
        }
      } else if (results.length > 1) {
        setCandidates(results);
        setIsSelectingFor('reference');
      } else {
        alert("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (error: any) {
      if (error.message === 'Aborted') return;
      console.error(error);
      alert("Ocurrió un error en la búsqueda.");
    } finally {
      setIsLoading(false);
      setCurrentAbortController(null);
    }
  };

  const handleAddDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaceInput || !referenceLocation) return;
    const controller = new AbortController();
    setCurrentAbortController(controller);
    setLoadingMessage({
      title: 'Buscando Destino',
      description: `Buscando "${newPlaceInput}" cerca de ${referenceLocation.name.split(',')[0]}...`
    });
    setIsLoading(true);
    try {
      const { candidates: results } = await getPlaceDetails(newPlaceInput, referenceLocation.name, controller.signal);
      if (results.length === 1) {
        let details = results[0];
        if (details.coordinates && referenceLocation.coordinates) {
          const stats = await getRouteStats(referenceLocation.coordinates, details.coordinates);
          details = { ...details, distanceFromRef: stats?.distance, travelTime: stats?.duration };
        }
        setDestinations(prev => [...prev, details]);
        setNewPlaceInput('');
      } else if (results.length > 1) {
        // Pre-calcular distancias para todos los candidatos
        const candidatesWithStats = await Promise.all(results.map(async (cand) => {
          if (cand.coordinates && referenceLocation.coordinates) {
            const stats = await getRouteStats(referenceLocation.coordinates, cand.coordinates);
            return { ...cand, distanceFromRef: stats?.distance, travelTime: stats?.duration };
          }
          return cand;
        }));
        setCandidates(candidatesWithStats);
        setIsSelectingFor('destination');
      } else {
        alert("No se encontró el lugar. Intenta ser más específico.");
      }
    } catch (error: any) {
      if (error.message === 'Aborted') return;
      console.error(error);
      alert("Ocurrió un error en la búsqueda.");
    } finally {
      setIsLoading(false);
      setCurrentAbortController(null);
    }
  };

  const handleSelectCandidate = async (candidate: LocationDetails) => {
    if (isSelectingFor === 'reference') {
      setReferenceLocation(candidate);
      if (destinations.length > 0) {
        const controller = new AbortController();
        setCurrentAbortController(controller);
        setLoadingMessage({
          title: 'Actualizando Rutas',
          description: 'Recalculando todas las distancias desde tu nueva ubicación base.'
        });
        setIsLoading(true);
        const updated = await updateAllDistances(candidate, destinations);
        setDestinations(updated);
        setIsLoading(false);
        setCurrentAbortController(null);
      }
    } else if (isSelectingFor === 'destination') {
      // Ya tiene las distancias calculadas si venía de handleAddDestination o Sugerencias
      setDestinations(prev => [...prev, candidate]);
      setNewPlaceInput('');
    }
    setCandidates([]);
    setIsSelectingFor(null);
  };

  const removeDestination = (name: string) => {
    setDestinations(prev => prev.filter(d => d.name !== name));
  };

  const clearAllData = () => {
    if (window.confirm("¿Estás seguro de que quieres borrar todo el plan?")) {
      setReferenceLocation(null);
      setDestinations([]);
      setItinerary('');
      setSources([]);
      localStorage.clear();
      setRefInput('Merlo, San Luis, Argentina');
    }
  };

  useEffect(() => {
    const updateItinerary = async () => {
      if (!referenceLocation || destinations.length === 0) {
        setItinerary('');
        return;
      }
      const controller = new AbortController();
      setCurrentAbortController(controller);
      setLoadingMessage({
        title: 'Generando Itinerario',
        description: 'La IA está organizando tus destinos y creando una ruta lógica día por día.'
      });
      setIsLoading(true);
      try {
        const { itinerary: text, sources: s } = await generateItinerary(
          referenceLocation.name,
          destinations.map(d => d.name),
          controller.signal
        );
        setItinerary(text);
        setSources(prev => {
          const combined = [...prev, ...s];
          const unique = new Map();
          combined.forEach(item => { if (item.uri) unique.set(item.uri, item); });
          return Array.from(unique.values());
        });
      } catch (error: any) {
        if (error.message === 'Aborted') return;
        console.error(error);
      } finally {
        setIsLoading(false);
        setCurrentAbortController(null);
      }
    };
    const debounce = setTimeout(updateItinerary, 2000);
    return () => clearTimeout(debounce);
  }, [destinations, referenceLocation]);

  const handleSuggestDestinations = async () => {
    if (!referenceLocation) return;
    const controller = new AbortController();
    setCurrentAbortController(controller);
    setLoadingMessage({
      title: 'Buscando Ideas con IA',
      description: `Analizando los mejores puntos de interés cerca de ${referenceLocation.name.split(',')[0]}...`
    });
    setIsLoading(true);
    try {
      const { candidates: results } = await getSuggestedDestinations(referenceLocation.name, controller.signal);
      if (results.length > 0) {
        // Pre-calcular distancias para las sugerencias
        const candidatesWithStats = await Promise.all(results.map(async (cand) => {
          if (cand.coordinates && referenceLocation.coordinates) {
            const stats = await getRouteStats(referenceLocation.coordinates, cand.coordinates);
            return { ...cand, distanceFromRef: stats?.distance, travelTime: stats?.duration };
          }
          return cand;
        }));
        setCandidates(candidatesWithStats);
        setIsSelectingFor('destination');
      } else {
        alert("No pude encontrar sugerencias en este momento.");
      }
    } catch (error: any) {
      if (error.message === 'Aborted') return;
      console.error(error);
      alert("Error al obtener sugerencias.");
    } finally {
      setIsLoading(false);
      setCurrentAbortController(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100">
      {/* Global Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-white flex flex-col items-center max-w-sm w-full text-center">
            <div className="relative mb-8">
              <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></div>
              </div>
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">
              {loadingMessage.title || 'TripRoute IA Trabajando'}
            </h3>
            <p className="text-slate-500 text-sm font-medium mb-8 leading-relaxed">
              {loadingMessage.description || 'Estamos calculando las mejores rutas y lugares para tu viaje. Esto tomará solo unos segundos.'}
            </p>
            <button
              onClick={handleCancelRequest}
              className="group flex items-center gap-3 px-8 py-4 bg-red-50 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl transition-all duration-300 font-black text-xs uppercase tracking-widest border-2 border-red-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              Cancelar Proceso
            </button>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        <header className="mb-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                TripRoute <span className="text-indigo-600">Master</span>
              </h1>
            </div>
            <p className="text-slate-500 font-medium">Cálculos de ruta exactos con inteligencia geográfica.</p>
          </div>

          {(referenceLocation || destinations.length > 0) && (
            <button
              onClick={clearAllData}
              className="group flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-red-500 hover:text-white hover:bg-red-500 border-2 border-red-50 rounded-2xl transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Reiniciar
            </button>
          )}
        </header>

        {/* Mobile Tabs */}
        <div className="xl:hidden flex mb-8 bg-white/50 backdrop-blur p-1 rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setActiveTab('destinations')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'destinations' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Destinos
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'map' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Mapa
          </button>
          <button
            onClick={() => setActiveTab('itinerary')}
            className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'itinerary' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Itinerario
          </button>
        </div>

        {candidates.length > 0 && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-white overflow-hidden animate-in fade-in zoom-in duration-300">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900">¿Cuál es el lugar?</h3>
                  <p className="text-sm text-slate-500 font-medium">Encontré varias opciones.</p>
                </div>
                <button
                  onClick={() => { setCandidates([]); setIsSelectingFor(null); }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto space-y-3 custom-scrollbar">
                {candidates.map((cand, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectCandidate(cand)}
                    className="w-full text-left p-6 rounded-3xl border-2 border-slate-50 hover:border-indigo-500 hover:bg-indigo-50/50 transition-all group relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{cand.name}</h4>
                      {cand.distanceFromRef && (
                        <div className="flex gap-2">
                          <span className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[9px] font-black rounded-lg uppercase tracking-wider">
                            {cand.distanceFromRef}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-4">{cand.description}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] font-black text-indigo-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">
                        Seleccionar éste
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                      </div>
                      {cand.travelTime && (
                        <span className="text-[10px] font-bold text-slate-400">
                          ⏱️ ~{cand.travelTime}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="p-6 bg-slate-50 text-center">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  ¿No es lo que buscabas? Intentá ser más específico en tu búsqueda.
                </p>
              </div>
            </div>
          </div>
        )}

        <main className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">

          <aside className={`xl:col-span-4 space-y-6 ${activeTab !== 'destinations' ? 'hidden xl:block' : ''}`}>
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60 ring-1 ring-slate-100">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                Punto de Referencia
              </h2>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  placeholder="Ciudad base..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all text-sm font-medium"
                />
                <button
                  onClick={handleUseCurrentLocation}
                  disabled={isLoading}
                  className="p-3 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-2xl transition-all border border-indigo-100 disabled:opacity-50"
                  title="Usar mi ubicación"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </button>
                <button
                  onClick={handleSetReference}
                  disabled={isLoading}
                  className="bg-slate-900 hover:bg-black text-white px-5 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center min-w-[56px]"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  )}
                </button>
              </div>
              {isLoading && refInput && !referenceLocation && (
                <div className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/30 animate-pulse">
                  <div className="h-4 w-32 bg-indigo-200 rounded-lg mb-4"></div>
                  <div className="h-3 w-full bg-slate-100 rounded-lg mb-2"></div>
                  <div className="h-3 w-4/5 bg-slate-100 rounded-lg"></div>
                </div>
              )}
              {referenceLocation && !isLoading && <PlaceCard place={referenceLocation} onRemove={() => { }} isReference />}
              {referenceLocation && isLoading && <PlaceCard place={referenceLocation} onRemove={() => { }} isReference />}
            </section>

            {referenceLocation && (
              <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60 ring-1 ring-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    Destinos
                  </h2>
                  <button
                    onClick={handleSuggestDestinations}
                    disabled={isLoading}
                    className="text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-xl transition-all uppercase tracking-widest border border-indigo-100 disabled:opacity-50"
                  >
                    ✨ Sugerime destinos
                  </button>
                </div>
                <form onSubmit={handleAddDestination} className="space-y-3 mb-6">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newPlaceInput}
                      onChange={(e) => setNewPlaceInput(e.target.value)}
                      placeholder={`Ej: ${referenceLocation.name.split(',')[0]} Centro, Parque...`}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 text-sm font-medium"
                    />
                    <button type="submit" disabled={isLoading || !newPlaceInput} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center min-w-[56px]">
                      {isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4" /></svg>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Buscando cerca de <span className="text-indigo-500">{referenceLocation.name.split(',')[0]}</span>
                    </p>
                    {isLoading && (
                      <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-black animate-pulse uppercase tracking-widest">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" /></svg>
                        Google Maps AI
                      </span>
                    )}
                  </div>
                </form>

                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar overflow-x-hidden">
                  {destinations.length === 0 && !isLoading && (
                    <div className="py-12 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                      <p className="text-sm text-slate-400 font-medium">No hay destinos aún</p>
                    </div>
                  )}

                  {destinations.map((dest, idx) => (
                    <PlaceCard key={idx} place={dest} onRemove={removeDestination} />
                  ))}

                  {isLoading && newPlaceInput && (
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
            <div className={`rounded-3xl overflow-hidden shadow-2xl shadow-indigo-100 border border-white ${activeTab !== 'map' ? 'hidden xl:block' : ''}`}>
              <MapComponent reference={referenceLocation} destinations={destinations} activeTab={activeTab} userPosition={userPosition} />
            </div>

            <section className={`bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-w-0 ${activeTab !== 'itinerary' ? 'hidden xl:block' : ''}`}>
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-black text-slate-900">Itinerario sugerido</h2>
                  {!isLoading && (itinerary || destinations.length > 0) && (
                    <span className="hidden sm:inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">
                      Ruta Optimizada
                    </span>
                  )}
                </div>
                {isLoading && (
                  <div className="flex items-center gap-2 text-indigo-600 text-sm font-bold animate-pulse">
                    <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></div>
                    Recalculando tiempos...
                  </div>
                )}
              </div>

              <div className="p-8 min-w-0">
                {itinerary ? (
                  <div className="prose prose-slate max-w-none break-words">
                    {itinerary.split('\n').map((line, i) => {
                      const renderLineWithLinks = (text: string) => {
                        let parts: (string | React.ReactNode)[] = [text];
                        destinations.forEach(dest => {
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
                                      onClick={() => setActiveTab('map')}
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

            {/* Footer with sources hidden as requested */}
            {sources.length > 0 && false && (
              <footer className="pb-10">
                <div className="flex flex-wrap gap-2">
                  {sources.map((source, idx) => (
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
