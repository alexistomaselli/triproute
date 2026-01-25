
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { LocationDetails, GroundingSource } from "../types";

// Utility to get the API Key safely
const getApiKey = () => {
  // 1. Look for runtime injection
  const runtimeKey = (window as any).VITE_API_KEY;

  // 2. Look for build-time injection
  const buildKey = (import.meta as any).env?.VITE_API_KEY;

  let finalKey = "";

  if (runtimeKey &&
    runtimeKey !== "__VITE_API_KEY_PLACEHOLDER__" &&
    runtimeKey.trim() !== "" &&
    !runtimeKey.includes("PLACEHOLDER")) {
    finalKey = runtimeKey;
  } else if (buildKey && buildKey.trim() !== "") {
    finalKey = buildKey;
  }

  // Clean the key: remove quotes and spaces that Easypanel might add
  finalKey = finalKey.replace(/['"]+/g, '').trim();

  return finalKey;
};

let ai: any = null;

const getAIClient = () => {
  if (ai) return ai;
  const key = getApiKey();

  if (!key) {
    console.error("DIAGNOSTIC: No API Key found in either window.VITE_API_KEY or import.meta.env. AI will fail.");
    return null;
  }

  try {
    ai = new GoogleGenAI(key);
    console.log("DIAGNOSTIC: AI Client initialized with key length:", key.length);
    return ai;
  } catch (e) {
    console.error("DIAGNOSTIC: Failed to initialize GoogleGenAI:", e);
    return null;
  }
};

export const getPlaceDetails = async (
  placeName: string,
  referenceLocation: string,
  signal?: AbortSignal
): Promise<{ candidates: LocationDetails[]; sources: GroundingSource[] }> => {
  const client = getAIClient();
  if (!client) throw new Error("API Key no configurada.");

  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    tools: [{ googleMaps: {} } as any],
  });

  const prompt = `INSTRUCCIÓN SISTEMA: ERES UN MOTOR DE BÚSQUEDA GEOGRÁFICO. NO SALUDES. NO DEAS EXPLICACIONES. SOLO RESPONDE EN EL FORMATO SOLICITADO.

  Identifica el lugar "${placeName}" cerca de "${referenceLocation}". 
  REGLAS CRÍTICAS:
  1. Si existen múltiples lugares con nombres similares o idénticos (ej: un hotel y un lago), DEBES devolver todas las opciones (hasta 5).
  2. Si el nombre es ambiguo, ofrece alternativas.
  3. Corrige nombres parciales al oficial.
  
  FORMATO DE RETORNO (OBLIGATORIO - UNA LÍNEA POR LUGAR):
  LUGAR: Nombre oficial | Descripción breve y real | Latitud, Longitud`;

  const response = await model.generateContent(prompt);

  if (signal?.aborted) throw new Error("Aborted");

  const text = response.text || "";
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  const sources: GroundingSource[] = groundingChunks
    .filter((chunk: any) => chunk.maps)
    .map((chunk: any) => ({
      title: chunk.maps?.title,
      uri: chunk.maps?.uri
    }));

  const lines = text.split('\n');
  const candidates: LocationDetails[] = [];

  for (const line of lines) {
    const match = line.match(/LUGAR:\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
    if (match) {
      candidates.push({
        name: match[1].trim(),
        description: match[2].trim(),
        activities: [],
        distanceFromRef: "Cálculo pendiente...",
        mapsUri: sources[0]?.uri,
        coordinates: { lat: parseFloat(match[3]), lng: parseFloat(match[4]) }
      });
    }
  }

  return { candidates, sources };
};

export const getSuggestedDestinations = async (
  referenceLocation: string,
  signal?: AbortSignal
): Promise<{ candidates: LocationDetails[]; sources: GroundingSource[] }> => {
  const client = getAIClient();
  if (!client) throw new Error("API Key no configurada.");

  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    tools: [{ googleMaps: {} } as any],
  });

  const prompt = `Busca las 5 mejores atracciones turísticas y puntos de interés únicos cerca de "${referenceLocation}". 
  Debes ser específico y encontrar lugares reales (miradores, cascadas, museos, parques).
  
  FORMATO DE RETORNO (OBLIGATORIO):
  Escribe una línea por cada lugar encontrado con este formato exacto:
  LUGAR: Nombre | Descripción Breve | Latitud, Longitud`;

  const response = await model.generateContent(prompt);

  if (signal?.aborted) throw new Error("Aborted");

  const text = response.text || "";
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  const sources: GroundingSource[] = groundingChunks
    .filter((chunk: any) => chunk.maps)
    .map((chunk: any) => ({
      title: chunk.maps?.title,
      uri: chunk.maps?.uri
    }));

  const lines = text.split('\n');
  const candidates: LocationDetails[] = [];

  for (const line of lines) {
    // Intentar el formato estándar
    const match = line.match(/(?:LUGAR|ITEM):\s*(?:\[)?(.*?)(?:\])?\s*\|\s*(?:\[)?(.*?)(?:\])?\s*\|\s*(?:\[)?(-?\d+\.\d+),\s*(-?\d+\.\d+)(?:\])?/i);
    if (match) {
      candidates.push({
        name: match[1].trim(),
        description: match[2].trim(),
        activities: [],
        distanceFromRef: "Cálculo pendiente...",
        mapsUri: sources[0]?.uri,
        coordinates: { lat: parseFloat(match[3]), lng: parseFloat(match[4]) }
      });
    }
  }

  // Fallback agresivo: si no hay formato pero hay líneas con coordenadas
  if (candidates.length === 0) {
    for (const line of lines) {
      const coordsMatch = line.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (coordsMatch && line.length > 20) {
        const parts = line.split(/[|:-]/);
        candidates.push({
          name: parts[0].replace(/LUGAR|ITEM|[*#]/gi, '').trim() || "Lugar sugerido",
          description: parts[1]?.trim() || "Atracción turística cercana.",
          activities: [],
          distanceFromRef: "Cálculo pendiente...",
          mapsUri: sources[0]?.uri,
          coordinates: { lat: parseFloat(coordsMatch[1]), lng: parseFloat(coordsMatch[2]) }
        });
      }
    }
  }

  return { candidates, sources };
};

export const generateItinerary = async (
  referenceLocation: string,
  destinations: string[],
  signal?: AbortSignal
): Promise<{ itinerary: string; sources: GroundingSource[] }> => {
  if (destinations.length === 0) return { itinerary: "", sources: [] };

  const prompt = `Crea un itinerario de viaje optimizado para visitar los siguientes lugares desde el punto de referencia "${referenceLocation}":
  Lugares a visitar: ${destinations.join(", ")}.
  
  REGLAS:
  1. Organiza los días de forma lógica basándote en la cercanía geográfica. 
  2. Para cada día, explica qué conocer y por qué ese orden.
  3. Sugiere horarios recomendados (mañana, tarde, atardecer).
  4. Menciona consejos locales (donde sacar fotos, qué llevar, precauciones de seguridad o clima).
  5. Mantén un tono entusiasta y servicial para un viajero de vacaciones.
  6. Responde en ESPAÑOL.
  7. NO incluyas introducciones ni despedidas conversacionales.`;

  const client = getAIClient();
  if (!client) throw new Error("API Key no configurada.");

  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
  });

  const response = await model.generateContent(prompt);

  if (signal?.aborted) throw new Error("Aborted");

  const itineraryText = response.text || "No se pudo generar el itinerario.";

  return {
    itinerary: itineraryText,
    sources: []
  };
};
