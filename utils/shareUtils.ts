
/**
 * Utilities for serializing and deserializing trip state into URLs.
 */

export const compressTrip = (data: any): string => {
    try {
        const jsonString = JSON.stringify(data);
        // Using btoa for a simple Base64 encoding. 
        // In production, one might use a more robust compression library like lz-string.
        return btoa(encodeURIComponent(jsonString));
    } catch (error) {
        console.error("Error compressing trip data:", error);
        return "";
    }
};

export const decompressTrip = (encodedData: string): any => {
    try {
        const decodedString = decodeURIComponent(atob(encodedData));
        return JSON.parse(decodedString);
    } catch (error) {
        console.error("Error decompressing trip data:", error);
        return null;
    }
};
