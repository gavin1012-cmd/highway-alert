// GPS 定位、方向計算、前方座標推算

const Geo = (() => {
  let watchId = null;
  let lastPosition = null;
  let prevPosition = null;
  let onUpdateCallback = null;

  // 取得目前位置資訊（lat, lng, speed km/h, heading 度數）
  function getState() {
    return lastPosition;
  }

  // 開始 GPS 追蹤
  function startTracking(onUpdate) {
    onUpdateCallback = onUpdate;
    if (!navigator.geolocation) {
      console.error('[Geo] Geolocation not supported');
      return false;
    }
    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return true;
  }

  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    lastPosition = null;
    prevPosition = null;
  }

  function handlePosition(pos) {
    const coords = pos.coords;

    // 計算 heading：優先使用設備 API，否則從兩點計算
    let heading = coords.heading;
    if ((heading === null || isNaN(heading)) && prevPosition) {
      heading = bearingBetween(
        prevPosition.lat, prevPosition.lng,
        coords.latitude, coords.longitude
      );
    }

    // GPS 速度（m/s → km/h），若無則保留上次
    let speedKmh = coords.speed != null ? coords.speed * 3.6 : (lastPosition?.speed ?? 0);
    speedKmh = Math.max(0, Math.round(speedKmh));

    prevPosition = lastPosition;
    lastPosition = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      speed: speedKmh,
      heading: heading ?? 0,
      timestamp: pos.timestamp,
    };

    if (onUpdateCallback) onUpdateCallback(lastPosition);
  }

  function handleError(err) {
    console.warn('[Geo] Error', err.code, err.message);
  }

  // 計算從 (lat1,lng1) 到 (lat2,lng2) 的方位角（度）
  function bearingBetween(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const dLng = toRad(lng2 - lng1);
    const rlat1 = toRad(lat1), rlat2 = toRad(lat2);
    const y = Math.sin(dLng) * Math.cos(rlat2);
    const x = Math.cos(rlat1) * Math.sin(rlat2) -
               Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // 從給定座標沿方位角推算 distKm km 後的座標
  function pointAhead(lat, lng, headingDeg, distKm) {
    const R = 6371; // 地球半徑 km
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;

    const d = distKm / R;
    const b = toRad(headingDeg);
    const rlat = toRad(lat);
    const rlng = toRad(lng);

    const newLat = Math.asin(
      Math.sin(rlat) * Math.cos(d) +
      Math.cos(rlat) * Math.sin(d) * Math.cos(b)
    );
    const newLng = rlng + Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(rlat),
      Math.cos(d) - Math.sin(rlat) * Math.sin(newLat)
    );

    return { lat: toDeg(newLat), lng: toDeg(newLng) };
  }

  // 計算前方各距離的座標點
  function getAheadPoints(position, distances = [3, 5, 8, 10]) {
    if (!position) return [];
    return distances.map(km => ({
      km,
      ...pointAhead(position.lat, position.lng, position.heading, km),
    }));
  }

  // 依車速決定預警距離（km）
  function getAlertDistance(speedKmh, setting = 'auto') {
    if (setting !== 'auto') return parseFloat(setting);
    if (speedKmh >= 100) return 8;
    if (speedKmh >= 70)  return 5;
    return 3;
  }

  // 兩點間距離（km）
  function distanceBetween(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 方位角轉顯示文字
  function headingToText(deg) {
    const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    return dirs[Math.round(deg / 45) % 8];
  }

  return {
    startTracking,
    stopTracking,
    getState,
    getAheadPoints,
    getAlertDistance,
    distanceBetween,
    pointAhead,
    bearingBetween,
    headingToText,
  };
})();
