
import React from 'react';
import { LocationDetails } from '../types';

interface PlaceCardProps {
  place: LocationDetails;
  onRemove: (name: string) => void;
  isReference?: boolean;
}

export const PlaceCard: React.FC<PlaceCardProps> = ({ place, onRemove, isReference = false }) => {
  return (
    <div className={`group relative p-5 rounded-2xl border transition-all duration-300 break-words ${
      isReference 
        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-100' 
        : 'bg-white border-slate-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-slate-200/50'
    }`}>
      <div className="flex justify-between items-start gap-3 mb-2">
        <div className="min-w-0">
          <h3 className={`font-black text-base truncate leading-tight ${isReference ? 'text-white' : 'text-slate-900'}`}>
            {place.name}
          </h3>
          
          {!isReference && (place.distanceFromRef || place.travelTime) && (
            <div className="flex items-center gap-2 mt-2">
              <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-indigo-100 flex items-center gap-1.5">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                {place.distanceFromRef || "Calculando..."}
              </span>
              {place.travelTime && (
                <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-amber-100 flex items-center gap-1.5">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {place.travelTime}
                </span>
              )}
            </div>
          )}
        </div>
        
        {!isReference && (
          <button 
            onClick={() => onRemove(place.name)}
            className="flex-shrink-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
            title="Eliminar destino"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
      
      <div className={`text-xs leading-relaxed mb-4 line-clamp-3 group-hover:line-clamp-none transition-all ${isReference ? 'text-indigo-100' : 'text-slate-500'}`}>
        {place.description}
      </div>

      {place.mapsUri && (
        <a 
          href={place.mapsUri} 
          target="_blank" 
          rel="noopener noreferrer"
          className={`inline-flex items-center text-[10px] font-black uppercase tracking-widest transition-all ${
            isReference ? 'text-white underline-offset-4 hover:underline' : 'text-indigo-600 hover:text-indigo-800'
          }`}
        >
          <svg className="h-3 w-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
          Abrir en Google Maps
        </a>
      )}
    </div>
  );
};
