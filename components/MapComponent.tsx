
import React, { useEffect, useRef } from 'react';
import { LocationDetails } from '../types';

interface MapComponentProps {
  reference: LocationDetails | null;
  destinations: LocationDetails[];
  activeTab?: string;
  userPosition?: { lat: number, lng: number } | null;
}

export const MapComponent: React.FC<MapComponentProps> = ({ reference, destinations, activeTab, userPosition }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routesRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);

  // Función para centrar en la base
  const centerOnBase = () => {
    if (mapRef.current && reference?.coordinates) {
      mapRef.current.setView([reference.coordinates.lat, reference.coordinates.lng], 13);
    }
  };

  const centerOnUser = () => {
    if (mapRef.current && userPosition) {
      mapRef.current.setView([userPosition.lat, userPosition.lng], 15);
    }
  };

  const fetchRoute = async (start: { lat: number; lng: number }, end: { lat: number; lng: number }) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]]);
      }
    } catch (error) {
      console.error("Error al obtener la ruta:", error);
    }
    return [[start.lat, start.lng], [end.lat, end.lng]];
  };

  // Corregir tamaño cuando cambia la visibilidad (tabs en movil)
  useEffect(() => {
    if (activeTab === 'map' && mapRef.current) {
      setTimeout(() => {
        mapRef.current.invalidateSize();
      }, 100);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const L = (window as any).L;
    if (!L) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: false,
        scrollWheelZoom: true,
        attributionControl: false // Ocultar atribución por defecto de Leaflet
      }).setView([-34.6037, -58.3816], 4);

      L.control.zoom({ position: 'topright' }).addTo(mapRef.current);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapRef.current);
    }

    const updateMapElements = async () => {
      markersRef.current.forEach(m => m.remove());
      routesRef.current.forEach(r => r.remove());
      markersRef.current = [];
      routesRef.current = [];

      const bounds = L.latLngBounds([]);

      if (reference?.coordinates) {
        const refIcon = L.divIcon({
          className: 'custom-marker-reference',
          html: `
            <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
              <div style="
                background: #4f46e5; 
                padding: 4px 10px; 
                border-radius: 10px; 
                font-size: 11px; 
                font-weight: 800; 
                color: white;
                white-space: nowrap;
                box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
                margin-bottom: 6px;
                transform: translateY(-5px);
                border: 2px solid white;
              ">
                BASE: ${reference.name}
              </div>
              <div style="
                background-color: #4f46e5; 
                width: 14px; 
                height: 14px; 
                border-radius: 50%; 
                border: 3px solid white; 
                box-shadow: 0 0 15px rgba(79, 70, 229, 0.5);
              "></div>
            </div>
          `,
          iconSize: [120, 50],
          iconAnchor: [60, 50]
        });

        const marker = L.marker([reference.coordinates.lat, reference.coordinates.lng], { icon: refIcon })
          .addTo(mapRef.current);

        markersRef.current.push(marker);
        bounds.extend([reference.coordinates.lat, reference.coordinates.lng]);

        for (const dest of destinations) {
          if (dest.coordinates) {
            const statsLabel = (dest.distanceFromRef && dest.travelTime)
              ? `<span style="color: #6366f1; margin-left: 6px;">${dest.distanceFromRef} • ${dest.travelTime}</span>`
              : '';

            const destIcon = L.divIcon({
              className: 'custom-marker-destination',
              html: `
                <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
                  <div style="
                    background: rgba(255, 255, 255, 0.95); 
                    backdrop-filter: blur(4px);
                    padding: 4px 10px; 
                    border-radius: 8px; 
                    border: 1px solid #e2e8f0; 
                    font-size: 10px; 
                    font-weight: 700; 
                    color: #1e293b;
                    white-space: nowrap;
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                    margin-bottom: 5px;
                    transform: translateY(-2px);
                  ">
                    ${dest.name}${statsLabel}
                  </div>
                  <div style="
                    background-color: #1e293b; 
                    width: 10px; 
                    height: 10px; 
                    border-radius: 50%; 
                    border: 2px solid white;
                  "></div>
                </div>
              `,
              iconSize: [150, 40],
              iconAnchor: [75, 40]
            });

            const marker = L.marker([dest.coordinates.lat, dest.coordinates.lng], { icon: destIcon })
              .addTo(mapRef.current);

            markersRef.current.push(marker);
            bounds.extend([dest.coordinates.lat, dest.coordinates.lng]);

            const pathCoordinates = await fetchRoute(reference.coordinates, dest.coordinates);

            const routeLine = L.polyline(pathCoordinates, {
              color: '#6366f1',
              weight: 5,
              opacity: 0.6,
              lineCap: 'round',
              lineJoin: 'round',
              dashArray: '1, 10'
            }).addTo(mapRef.current);

            routesRef.current.push(routeLine);
          }
        }
      }

      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [100, 100], maxZoom: 15 });
      }
    };

    updateMapElements();

  }, [reference, destinations]);

  // Effect especial para el vehiculo (seguimiento suave)
  useEffect(() => {
    if (!mapRef.current || !userPosition) return;
    const L = (window as any).L;
    if (!L) return;

    if (!userMarkerRef.current) {
      const vehicleIcon = L.divIcon({
        className: 'user-vehicle-marker',
        html: `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <div style="
              background: #0ea5e9; 
              padding: 4px 10px; 
              border-radius: 10px; 
              font-size: 10px; 
              font-weight: 900; 
              color: white;
              white-space: nowrap;
              box-shadow: 0 4px 6px -1px rgba(14, 165, 233, 0.4);
              margin-bottom: 5px;
              border: 2px solid white;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            ">
              🚗 Mi Vehículo
            </div>
            <div style="
              width: 16px; 
              height: 16px; 
              background: #0ea5e9; 
              border: 3px solid white; 
              border-radius: 50%; 
              box-shadow: 0 0 15px rgba(14, 165, 233, 0.6);
            "></div>
          </div>
        `,
        iconSize: [100, 40],
        iconAnchor: [50, 40]
      });
      userMarkerRef.current = L.marker([userPosition.lat, userPosition.lng], {
        icon: vehicleIcon,
        zIndexOffset: 1000
      }).addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLatLng([userPosition.lat, userPosition.lng]);
    }
  }, [userPosition]);

  return (
    <div className="w-full h-[500px] relative overflow-hidden rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 border-4 border-white">
      <div ref={mapContainerRef} className="absolute inset-0 z-10" />

      <div className="absolute top-6 left-6 z-[1000] flex flex-col gap-3 pointer-events-none">
        <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-lg border border-slate-100 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
          <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Road Network Monitoring</span>
        </div>
      </div>

      <div className="absolute bottom-24 right-6 z-[1000] flex flex-col gap-3">
        {userPosition && (
          <button
            onClick={centerOnUser}
            className="bg-white hover:bg-sky-50 text-sky-600 p-4 rounded-2xl shadow-2xl border border-sky-100 transition-all active:scale-95 group"
            title="Centrar en Vehículo"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Donde estoy
            </span>
          </button>
        )}

        {reference?.coordinates && (
          <button
            onClick={centerOnBase}
            className="bg-white hover:bg-slate-50 text-indigo-600 p-4 rounded-2xl shadow-2xl border border-slate-100 transition-all active:scale-95 group"
            title="Centrar en Base"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              Ir a la Base
            </span>
          </button>
        )}
      </div>

      <div className="absolute bottom-6 right-6 z-[1000]">
        <div className="bg-slate-900/95 backdrop-blur px-3 py-2 rounded-xl text-[9px] font-bold text-white uppercase tracking-tighter shadow-2xl border border-white/10">
          Powered by DYDLabs
        </div>
      </div>
    </div>
  );
};
