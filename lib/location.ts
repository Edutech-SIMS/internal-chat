import * as Location from "expo-location";

/**
 * Calculates the distance between two points in meters using the Haversine formula
 */
export const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/**
 * Checks if the current location is within the allowed radius of a school
 * @returns {Promise<{ isWithinFence: boolean, distance: number, error?: string }>}
 */
export const checkGeofence = async (
    schoolLat: number,
    schoolLon: number,
    allowedRadiusMeters: number = 200
): Promise<{ isWithinFence: boolean; distance: number; error?: string }> => {
    try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
            return {
                isWithinFence: false,
                distance: Infinity,
                error: "Permission to access location was denied",
            };
        }

        const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });

        const distance = calculateDistance(
            location.coords.latitude,
            location.coords.longitude,
            schoolLat,
            schoolLon
        );

        return {
            isWithinFence: distance <= allowedRadiusMeters,
            distance: Math.round(distance),
        };
    } catch (error: any) {
        console.error("Error checking geofence:", error);
        return {
            isWithinFence: false,
            distance: Infinity,
            error: error.message || "Failed to get current location",
        };
    }
};
