/**
 * mapUtils.js
 * Geocoding + routing utilities for Mishwar
 *
 * - Static lat/lng table for all West Bank cities (fast, no API call)
 * - Nominatim fallback for unlisted cities
 * - OSRM (free) for route geometry, distance, duration
 */

// ─── Static geocoding table — all Palestinian/West Bank cities ───────────────
// Coordinates are [lat, lng]
export const CITY_COORDS = {
  // رام الله والبيرة
  'رام الله':    [31.9038, 35.2034],
  'البيرة':      [31.9123, 35.2209],
  'الرام':       [31.8453, 35.2292],
  'العيزرية':    [31.7750, 35.2726],
  'أبو ديس':     [31.7672, 35.2844],
  'بيتونيا':     [31.8960, 35.1669],
  'بيتين':       [31.9417, 35.2375],
  'دير الديبة':  [31.9275, 35.1800],
  'دير قديس':    [31.9500, 35.1083],
  'الجيب':       [31.8567, 35.1819],
  'الطيبة':      [32.0403, 35.2428],
  'قالقيلية':    [32.0889, 34.9772],
  'كفر نعمة':    [31.9500, 35.0725],
  'نعلين':       [31.9578, 35.0475],
  // جنين
  'جنين':        [32.4597, 35.2972],
  'اليامون':     [32.4958, 35.1764],
  'برقين':       [32.4692, 35.2711],
  'سيلة الظهر': [32.5450, 35.2261],
  'قبلان':       [32.3000, 35.2500],
  'قفين':        [32.3681, 35.0853],
  'مسلية':       [32.3750, 35.3083],
  'يعبد':        [32.4261, 35.1736],
  'الزبابدة':    [32.3731, 35.3294],
  // نابلس
  'نابلس':       [32.2211, 35.2544],
  'بيتا':        [32.1653, 35.3072],
  'بيت دجن':     [32.2000, 35.3667],
  'جمّاعين':     [32.1378, 35.1947],
  'حوّارة':      [32.1522, 35.2617],
  'العوجا':      [32.0944, 35.4219],
  'سالم':        [32.3008, 35.3086],
  'عين بويطة':   [32.2600, 35.2800],
  'قريوط':       [32.1333, 35.2167],
  'كفر قدوم':    [32.2758, 35.0908],
  'لوبان':       [32.1842, 35.2347],
  // طولكرم
  'طولكرم':      [32.3104, 35.0283],
  'علّار':       [32.3500, 35.0417],
  'الطيرة':      [32.2667, 34.9833],
  'عنبتا':       [32.3419, 35.0628],
  'شويكة':       [32.3556, 35.0300],
  // قلقيلية
  'قلقيلية':     [32.1883, 34.9706],
  'عزون':        [32.1894, 35.0125],
  'هبلة':        [32.1500, 34.9833],
  'عصيرة':       [32.2833, 35.2167],
  // سلفيت
  'سلفيت':       [32.0861, 35.1756],
  'برقة':        [32.1308, 35.1000],
  'بروقين':      [32.0872, 35.1239],
  'كفر الديك':   [32.0428, 35.0594],
  // الخليل
  'الخليل':      [31.5326, 35.0998],
  'دورا':        [31.4992, 35.0133],
  'الظاهرية':    [31.4081, 34.9706],
  'سعير':        [31.5894, 35.1419],
  'تفوح':        [31.5244, 35.0289],
  'يطا':         [31.4389, 35.1028],
  'إذنا':        [31.5578, 34.9786],
  'بني نعيم':    [31.5356, 35.1664],
  'بيت جبرين':   [31.6039, 34.9058],
  // بيت لحم
  'بيت لحم':     [31.7054, 35.2024],
  'بيت ساحور':   [31.6981, 35.2228],
  'بيت جالا':    [31.7153, 35.1847],
  'بتّير':       [31.7183, 35.1319],
  'الخضر':       [31.6833, 35.1667],
  'بيت فجار':    [31.6553, 35.1656],
  'نحالين':      [31.7189, 35.0578],
  // أريحا والأغوار
  'أريحا':       [31.8567, 35.4611],
  'نويعمة':      [31.9000, 35.4667],
  'الجفتليك':    [32.0000, 35.5167],
  'الخان الأحمر': [31.8208, 35.3906],
  // القدس
  'القدس القديمة': [31.7767, 35.2345],
  'ضواحي القدس': [31.7667, 35.2167],
  'شعفاط':      [31.8208, 35.2328],
  'سلوان':       [31.7681, 35.2358],
  'الطور':       [31.7783, 35.2528],
  'جبل المكبر':  [31.7500, 35.2333],
  // مدن إضافية
  'بديا':        [32.1014, 35.0406],
  'شقبا':        [31.9806, 35.0428],
  'مجدل بني فاضل': [32.0333, 35.2167],
};

/**
 * Get coordinates for a city name.
 * Tries static table first, falls back to Nominatim.
 */
export async function geocodeCity(cityName) {
  if (!cityName) return null;

  // Static lookup (instant, no API call)
  if (CITY_COORDS[cityName]) {
    return CITY_COORDS[cityName]; // [lat, lng]
  }

  // Nominatim fallback
  try {
    const query = encodeURIComponent(`${cityName}, West Bank, Palestine`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'ar,en' } }
    );
    const data = await res.json();
    if (data?.[0]) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch (e) {
    console.warn('Nominatim geocoding failed:', e);
  }

  return null;
}

/**
 * Calculate route between two cities using OSRM (free, no API key).
 * Returns { distance, duration, geometry }
 *   distance: string like "47 كم"
 *   duration: string like "52 دقيقة"
 *   geometry: GeoJSON LineString coordinates for drawing the route
 */
export async function calculateRoute(fromCity, toCity) {
  const [fromCoords, toCoords] = await Promise.all([
    geocodeCity(fromCity),
    geocodeCity(toCity),
  ]);

  if (!fromCoords || !toCoords) {
    return null;
  }

  const [fromLat, fromLng] = fromCoords;
  const [toLat, toLng] = toCoords;

  try {
    // OSRM public demo server — free, no key needed
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      return { fromCoords, toCoords, distance: null, duration: null, geometry: null };
    }

    const route = data.routes[0];
    const distanceKm = Math.round(route.distance / 1000);
    const durationMin = Math.round(route.duration / 60);

    // Format Arabic strings
    const distance = `${distanceKm} كم`;
    const duration = durationMin >= 60
      ? `${Math.floor(durationMin / 60)} س ${durationMin % 60} د`
      : `${durationMin} دقيقة`;

    return {
      fromCoords,
      toCoords,
      distance,
      duration,
      distanceKm,
      durationMin,
      geometry: route.geometry, // GeoJSON geometry
    };
  } catch (e) {
    console.warn('OSRM routing failed:', e);
    // Fallback: straight-line estimate
    const R = 6371;
    const dLat = (toLat - fromLat) * Math.PI / 180;
    const dLon = (toLng - fromLng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(fromLat*Math.PI/180)*Math.cos(toLat*Math.PI/180)*Math.sin(dLon/2)**2;
    const distKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 1.3); // road factor 1.3
    const durMin = Math.round(distKm * 1.2); // ~50 km/h average

    return {
      fromCoords,
      toCoords,
      distance: `${distKm} كم`,
      duration: durMin >= 60
        ? `${Math.floor(durMin / 60)} س ${durMin % 60} د`
        : `${durMin} دقيقة`,
      distanceKm: distKm,
      durationMin: durMin,
      geometry: null,
    };
  }
}

/**
 * Calculate a multi-stop route: from → stop1 → stop2 → ... → to
 * Uses OSRM with all waypoints in a single request.
 * Returns same shape as calculateRoute() plus stopCoords array.
 */
export async function calculateMultiStopRoute(fromCity, toCity, stops = []) {
  // No stops — fall back to simple 2-point route
  if (!stops || stops.length === 0) {
    const result = await calculateRoute(fromCity, toCity);
    return result ? { ...result, stopCoords: [] } : null;
  }

  // Geocode all points in parallel
  const stopCities = stops.map(s => s.city).filter(Boolean);
  const allCities  = [fromCity, ...stopCities, toCity];
  const allCoords  = await Promise.all(allCities.map(geocodeCity));

  if (!allCoords[0] || !allCoords[allCoords.length - 1]) return null;

  const validCoords = allCoords.filter(Boolean);
  const fromCoords  = allCoords[0];
  const toCoords    = allCoords[allCoords.length - 1];
  const stopCoords  = allCoords.slice(1, -1).filter(Boolean);

  try {
    // Build OSRM waypoints string: lng,lat;lng,lat;...
    const waypointStr = validCoords
      .map(([lat, lng]) => `${lng},${lat}`)
      .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${waypointStr}?overview=full&geometries=geojson`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      return { fromCoords, toCoords, stopCoords, distance: null, duration: null, geometry: null };
    }

    const route       = data.routes[0];
    const distanceKm  = Math.round(route.distance / 1000);
    const durationMin = Math.round(route.duration / 60);

    const distance = `${distanceKm} كم`;
    const duration = durationMin >= 60
      ? `${Math.floor(durationMin / 60)} س ${durationMin % 60} د`
      : `${durationMin} دقيقة`;

    return {
      fromCoords,
      toCoords,
      stopCoords,
      distance,
      duration,
      distanceKm,
      durationMin,
      geometry: route.geometry,
    };
  } catch (e) {
    console.warn('OSRM multi-stop routing failed:', e);
    return null;
  }
}
