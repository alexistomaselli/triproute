
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { LocationDetails, GroundingSource } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

export const getPlaceDetails = async (
  placeName: string, 
  referenceLocation: string
): Promise<{ details: LocationDetails; sources: GroundingSource[] }> => {
  const prompt = `Proporciona detalles sobre "${placeName}" en relación a "${referenceLocation}". 
  Incluye:
  1. Una descripción breve y atractiva.
  2. Actividades principales.
  3. La distancia aproximada por carretera desde "${referenceLocation}".
  4. MUY IMPORTANTE: Al final de tu respuesta, incluye las coordenadas geográficas aproximadas en el formato exacto: COORDS: [LATITUD, LONGITUD].
  
  Retorna la información en español.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleMaps: {} }],
    },
  });

  const text = response.text || "No se encontró información.";
  
  // Extraer coordenadas con Regex
  const coordsMatch = text.match(/COORDS:\s*\[(-?\d+\.\d+),\s*(-?\d+\.\d+)\]/);
  let coordinates;
  if (coordsMatch) {
    coordinates = {
      lat: parseFloat(coordsMatch[1]),
      lng: parseFloat(coordsMatch[2])
    };
  }

  const cleanDescription = text.replace(/COORDS:\s*\[.*\]/, "").trim();

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  const sources: GroundingSource[] = groundingChunks
    .filter(chunk => chunk.maps)
    .map(chunk => ({
      title: chunk.maps?.title,
      uri: chunk.maps?.uri
    }));

  return {
    details: {
      name: placeName,
      description: cleanDescription,
      activities: [],
      distanceFromRef: "Calculando distancia...",
      mapsUri: sources[0]?.uri,
      coordinates
    },
    sources
  };
};

export const generateItinerary = async (
  referenceLocation: string,
  destinations: string[]
): Promise<{ itinerary: string; sources: GroundingSource[] }> => {
  if (destinations.length === 0) return { itinerary: "", sources: [] };

  const prompt = `Crea un itinerario de viaje optimizado para visitar los siguientes lugares desde el punto de referencia "${referenceLocation}":
  Lugares a visitar: ${destinations.join(", ")}.
  Organiza los días de forma lógica basándote en la cercanía geográfica. 
  Para cada día, explica qué conocer y por qué ese orden.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const itineraryText = response.text || "No se pudo generar el itinerario.";
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  const sources: GroundingSource[] = groundingChunks
    .filter(chunk => chunk.web)
    .map(chunk => ({
      title: chunk.web?.title,
      uri: chunk.web?.uri
    }));

  return {
    itinerary: itineraryText,
    sources
  };
};
