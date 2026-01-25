
import React, { useEffect, useRef } from 'react';
import { LocationDetails } from '../types';

interface MapComponentProps {
  reference: LocationDetails | null;
  destinations: LocationDetails[];
}

export const MapComponent: React.FC<MapComponentProps> = ({ reference, destinations }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routesRef = useRef<any[]>([]);

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

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const L = (window as any).L;
    if (!L) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: false,
        scrollWheelZoom: true
      }).setView([-34.6037, -58.3816], 4);
      
      L.control.zoom({ position: 'topright' }).addTo(mapRef.current);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
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

  return (
    <div className="w-full h-[500px] relative overflow-hidden rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 border-4 border-white">
      <div ref={mapContainerRef} className="absolute inset-0 z-10" />
      
      <div className="absolute top-6 left-6 z-[1000] pointer-events-none">
        <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-lg border border-slate-100 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
          <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Road Network Monitoring</span>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 z-[1000]">
        <div className="bg-slate-900/95 backdrop-blur px-3 py-2 rounded-xl text-[9px] font-bold text-white uppercase tracking-tighter shadow-2xl border border-white/10">
          Powered by OSRM API
        </div>
      </div>
    </div>
  );
};
