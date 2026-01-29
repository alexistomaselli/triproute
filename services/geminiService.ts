
import { GoogleGenAI } from "@google/genai";
import { LocationDetails, GroundingSource } from "../types";

// Utility to get the API Key safely
const getApiKey = () => {
  const runtimeKey = (window as any).VITE_API_KEY;
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
  return finalKey.replace(/['"]+/g, '').trim();
};

let ai: GoogleGenAI | null = null;
const getAIClient = () => {
  if (ai) return ai;
  const key = getApiKey();
  if (!key) return null;
  // Usamos el constructor oficial del SDK @google/genai
  ai = new GoogleGenAI({ apiKey: key });
  return ai;
};

// Rate limiting and retry logic
const callGeminiWithRetry = async (modelName: string, prompt: string, signal?: AbortSignal, retries = 3, tools?: any[]) => {
  const client = getAIClient();
  if (!client) throw new Error("API Key no configurada.");

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[GenAI SDK] Llamando a ${modelName}, intento ${i + 1}...`);

      // Patrón oficial del SDK @google/genai: client.models.generateContent
      const response = await client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: tools ? { tools } : undefined
      });

      console.log("[GenAI SDK] Respuesta recibida satisfactoriamente.");
      // En este SDK .text es un getter (propiedad), no una función.
      return response;
    } catch (error: any) {
      console.error(`[GenAI SDK] Error en intento ${i + 1}:`, error);
      if (error.status === 429 && i < retries - 1) {
        console.log("Rate limit alcanzado, reintentando...");
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
};

export const getPlaceDetails = async (
  placeName: string,
  referenceLocation: string,
  referenceCoords?: { lat: number, lng: number },
  signal?: AbortSignal
): Promise<{ candidates: LocationDetails[]; sources: GroundingSource[] }> => {
  const coordContext = referenceCoords ? ` (en o cerca de lat: ${referenceCoords.lat}, lng: ${referenceCoords.lng})` : "";

  const prompt = `ERES UN EXPERTO EN GEOGRAFÍA Y TURISMO.
  Busca "${placeName}" en un radio de 100km alrededor de "${referenceLocation}"${coordContext}.
  
  REGLAS CRÍTICAS:
  1. ENCUENTRA LAS COORDENADAS: Debes proporcionar latitud y longitud numérica para CADA lugar.
  2. SI NO HAY DATOS EXACTOS: Usa tu conocimiento interno para dar una ubicación aproximada. NUNCA respondas con frases como "no se encontraron coordenadas".
  3. IDIOMA: Responde 100% en ESPAÑOL.
  4. FORMATO: Solo líneas que empiecen con "LUGAR:". Sin charlas ni introducciones.
  
  FORMATO (CUMPLE A RAJATABLA):
  LUGAR: Nombre | Descripción corta | Latitud, Longitud`;

  // Usamos gemini-2.0-flash con la herramienta googleSearch
  const response = await callGeminiWithRetry(
    "gemini-2.0-flash",
    prompt,
    signal,
    3,
    [{ googleSearch: {} }]
  );

  const text = response.text || "";
  console.log("[GenAI SDK] Texto recibido:", text);

  const groundingChunks = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources: GroundingSource[] = groundingChunks
    .filter((chunk: any) => chunk.web)
    .map((chunk: any) => ({
      title: chunk.web?.title,
      uri: chunk.web?.uri
    }));

  const lines = text.split('\n');
  const candidates: LocationDetails[] = [];

  for (const line of lines) {
    // Regex robusto que busca LUGAR: Nombre | Desc | Lat, Lng
    const match = line.match(/LUGAR:\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (match) {
      candidates.push({
        name: match[1].trim(),
        description: match[2].trim(),
        activities: [],
        distanceFromRef: "Pendiente...",
        mapsUri: `https://www.google.com/maps/search/?api=1&query=${match[3]},${match[4]}`,
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
  const prompt = `Busca las 5 mejores atracciones turísticas cerca de "${referenceLocation}". 
  
  REGLAS DE ORO:
  1. DEBES encontrar las coordenadas (latitud y longitud) exactas de cada lugar.
  2. Responde exclusivamente en ESPAÑOL.
  3. PROHIBIDO dar introducciones o explicaciones.
  4. SOLO RESPONDE CON LÍNEAS QUE SIGAN EL FORMATO:
     LUGAR: Nombre | Descripción | Latitud, Longitud`;

  const response = await callGeminiWithRetry(
    "gemini-2.0-flash",
    prompt,
    signal,
    3,
    [{ googleSearch: {} }]
  );

  const text = response.text || "";
  const lines = text.split('\n');
  const candidates: LocationDetails[] = [];

  for (const line of lines) {
    const match = line.match(/LUGAR:\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (match) {
      candidates.push({
        name: match[1].trim(),
        description: match[2].trim(),
        activities: [],
        distanceFromRef: "Pendiente...",
        coordinates: { lat: parseFloat(match[3]), lng: parseFloat(match[4]) }
      });
    }
  }

  return { candidates, sources: [] };
};

export const generateItinerary = async (
  referenceLocation: string,
  destinations: string[],
  signal?: AbortSignal
): Promise<{ itinerary: string; sources: GroundingSource[] }> => {
  if (destinations.length === 0) return { itinerary: "", sources: [] };

  const prompt = `Crea un itinerario para visitar ${destinations.join(", ")} desde "${referenceLocation}". Responde en ESPAÑOL.`;

  const response = await callGeminiWithRetry(
    "gemini-2.0-flash",
    prompt,
    signal
  );

  return {
    itinerary: response.text || "Error al generar itinerario.",
    sources: []
  };
};

export const getAutocompleteSuggestions = async (query: string, signal?: AbortSignal): Promise<LocationDetails[]> => {
  return [];
};
