
import React, { useState, useEffect, useCallback } from 'react';
import { LocationDetails, GroundingSource } from './types';
import { getPlaceDetails, generateItinerary } from './services/geminiService';
import { PlaceCard } from './components/PlaceCard';
import { MapComponent } from './components/MapComponent';

const STORAGE_KEYS = {
  REFERENCE: 'trip_master_ref',
  DESTINATIONS: 'trip_master_dests',
  ITINERARY: 'trip_master_itin',
  SOURCES: 'trip_master_sources'
};

const App: React.FC = () => {
  const [refInput, setRefInput] = useState('Merlo, San Luis, Argentina');
  const [referenceLocation, setReferenceLocation] = useState<LocationDetails | null>(null);
  const [destinations, setDestinations] = useState<LocationDetails[]>([]);
  const [newPlaceInput, setNewPlaceInput] = useState('');
  const [itinerary, setItinerary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sources, setSources] = useState<GroundingSource[]>([]);

  // Función para obtener distancia y tiempo reales via OSRM
  const getRouteStats = async (start: {lat: number, lng: number}, end: {lat: number, lng: number}) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.code === 'Ok' && data.routes.length > 0) {
        const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        const durationMins = Math.round(data.routes[0].duration / 60);
        let durationText = `${durationMins} min`;
        if (durationMins >= 60) {
          const hours = Math.floor(durationMins / 60);
          const mins = durationMins % 60;
          durationText = `${hours}h ${mins}min`;
        }
        return { distance: `${distanceKm} km`, time: durationText };
      }
    } catch (e) {
      console.error("Error fetching road stats", e);
    }
    return { distance: "N/A", time: "N/A" };
  };

  const updateAllDistances = useCallback(async (base: LocationDetails, dests: LocationDetails[]) => {
    if (!base.coordinates) return dests;
    
    const updated = await Promise.all(dests.map(async (d) => {
      if (d.coordinates) {
        const stats = await getRouteStats(base.coordinates!, d.coordinates);
        return { ...d, distanceFromRef: stats.distance, travelTime: stats.time };
      }
      return d;
    }));
    return updated;
  }, []);

  useEffect(() => {
    const savedRef = localStorage.getItem(STORAGE_KEYS.REFERENCE);
    const savedDests = localStorage.getItem(STORAGE_KEYS.DESTINATIONS);
    const savedItin = localStorage.getItem(STORAGE_KEYS.ITINERARY);
    const savedSources = localStorage.getItem(STORAGE_KEYS.SOURCES);

    if (savedRef) setReferenceLocation(JSON.parse(savedRef));
    if (savedDests) setDestinations(JSON.parse(savedDests));
    if (savedItin) setItinerary(savedItin);
    if (savedSources) setSources(JSON.parse(savedSources));
  }, []);

  useEffect(() => {
    if (referenceLocation) localStorage.setItem(STORAGE_KEYS.REFERENCE, JSON.stringify(referenceLocation));
    else localStorage.removeItem(STORAGE_KEYS.REFERENCE);
  }, [referenceLocation]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DESTINATIONS, JSON.stringify(destinations));
  }, [destinations]);

  const handleSetReference = async () => {
    if (!refInput) return;
    setIsLoading(true);
    try {
      const { details, sources: s } = await getPlaceDetails(refInput, refInput);
      setReferenceLocation(details);
      setSources(s);
      // Al cambiar la base, recalculamos distancias de destinos existentes
      if (destinations.length > 0) {
        const updated = await updateAllDistances(details, destinations);
        setDestinations(updated);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaceInput || !referenceLocation) return;
    setIsLoading(true);
    try {
      const { details, sources: s } = await getPlaceDetails(newPlaceInput, referenceLocation.name);
      
      // Calcular ruta real inmediatamente
      if (details.coordinates && referenceLocation.coordinates) {
        const stats = await getRouteStats(referenceLocation.coordinates, details.coordinates);
        details.distanceFromRef = stats.distance;
        details.travelTime = stats.time;
      }

      setDestinations(prev => [...prev, details]);
      setSources(prev => {
        const combined = [...prev, ...s];
        const unique = new Map();
        combined.forEach(item => { if (item.uri) unique.set(item.uri, item); });
        return Array.from(unique.values());
      });
      setNewPlaceInput('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
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
      setIsLoading(true);
      try {
        const { itinerary: text, sources: s } = await generateItinerary(
          referenceLocation.name,
          destinations.map(d => d.name)
        );
        setItinerary(text);
        setSources(prev => {
          const combined = [...prev, ...s];
          const unique = new Map();
          combined.forEach(item => { if (item.uri) unique.set(item.uri, item); });
          return Array.from(unique.values());
        });
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    const debounce = setTimeout(updateItinerary, 2000);
    return () => clearTimeout(debounce);
  }, [destinations, referenceLocation]);

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100">
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
              Reiniciar Plan
            </button>
          )}
        </header>

        <main className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          <aside className="xl:col-span-4 space-y-6">
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
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 transition-all text-sm font-medium"
                />
                <button onClick={handleSetReference} disabled={isLoading} className="bg-slate-900 hover:bg-black text-white px-5 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                </button>
              </div>
              {referenceLocation && <PlaceCard place={referenceLocation} onRemove={() => {}} isReference />}
            </section>

            {referenceLocation && (
              <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200/60 ring-1 ring-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Destinos
                </h2>
                <form onSubmit={handleAddDestination} className="flex gap-2 mb-6">
                  <input 
                    type="text"
                    value={newPlaceInput}
                    onChange={(e) => setNewPlaceInput(e.target.value)}
                    placeholder="Próxima parada..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 text-sm font-medium"
                  />
                  <button type="submit" disabled={isLoading || !newPlaceInput} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                  </button>
                </form>

                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar overflow-x-hidden">
                  {destinations.length === 0 ? (
                    <div className="py-12 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                      <p className="text-sm text-slate-400 font-medium">No hay destinos aún</p>
                    </div>
                  ) : (
                    destinations.map((dest, idx) => (
                      <PlaceCard key={idx} place={dest} onRemove={removeDestination} />
                    ))
                  )}
                </div>
              </section>
            )}
          </aside>

          <div className="xl:col-span-8 space-y-8 min-w-0">
            <div className="rounded-3xl overflow-hidden shadow-2xl shadow-indigo-100 border border-white">
              <MapComponent reference={referenceLocation} destinations={destinations} />
            </div>

            <section className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-w-0">
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
                      if (line.trim().startsWith('#') || line.trim().startsWith('Día')) {
                        return <h3 key={i} className="text-xl font-black mt-8 mb-4 text-slate-900 border-l-4 border-indigo-500 pl-4">{line.replace(/^#+\s*/, '')}</h3>;
                      }
                      if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
                        return (
                          <div key={i} className="flex gap-3 mb-3 items-start group">
                            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 group-hover:scale-150 transition-transform"></div>
                            <p className="text-slate-600 font-medium leading-relaxed m-0">{line.substring(1).trim()}</p>
                          </div>
                        );
                      }
                      return line.trim() ? <p key={i} className="mb-6 text-slate-500 leading-relaxed text-lg">{line}</p> : null;
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-300">
                    <div className="w-24 h-24 mb-6 opacity-10">
                       <svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                    </div>
                    <p className="text-lg font-bold">Planifica tus vacaciones basándote en tiempos reales de viaje</p>
                  </div>
                )}
              </div>
            </section>

            {sources.length > 0 && (
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
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
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
