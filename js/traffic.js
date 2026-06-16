// 路況資料取得與解析（前端直接呼叫 Worker CORS proxy）

const Traffic = (() => {
  // VD 站位快取（靜態座標資料）
  let stationCache = null;
  let lastFetchTime = 0;
  // 最新各站路況 { stationId: { speed, level, lat, lng, name } }
  let latestConditions = {};

  // 路況等級
  const LEVEL = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3, UNKNOWN: -1 };
  const LEVEL_NAME = { 0: '暢通', 1: '車多', 2: '壅塞', 3: '嚴重壅塞', '-1': '未知' };
  const LEVEL_CLASS = { 0: 'green', 1: 'yellow', 2: 'orange', 3: 'red', '-1': 'unknown' };

  function speedToLevel(speed) {
    const t = APP_CONFIG.SPEED_THRESHOLDS;
    if (speed < 0) return LEVEL.UNKNOWN;
    if (speed >= t.GREEN)  return LEVEL.GREEN;
    if (speed >= t.YELLOW) return LEVEL.YELLOW;
    if (speed >= t.ORANGE) return LEVEL.ORANGE;
    return LEVEL.RED;
  }

  // 透過 Cloudflare Worker 的 CORS proxy 取路況
  async function fetchViaWorker(lat, lng) {
    const workerUrl = APP_CONFIG.WORKER_URL;
    if (!workerUrl) throw new Error('Worker URL 未設定');
    const url = `${workerUrl}/traffic?lat=${lat}&lng=${lng}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Worker 回應 ${res.status}`);
    return res.json();
  }

  // 直接呼叫 TISVCLOUD（若有 CORS 允許，螢幕亮時備用）
  async function fetchTISVCLOUD() {
    const now = new Date();
    const min5 = Math.floor(now.getUTCMinutes() / 5) * 5;
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}`;
    const hourStr = pad(now.getUTCHours() + 8 > 23 ? now.getUTCHours() + 8 - 24 : now.getUTCHours() + 8);
    const minStr = pad(min5 === 0 && now.getUTCMinutes() < 5 ? 55 : min5 - 5);
    // 實際上取前一個 5 分鐘時段（最新可用資料）
    const url = `https://tisvcloud.freeway.gov.tw/history/TDCS/M05A/${dateStr}/${hourStr}/M05A_${dateStr}_${hourStr}${minStr}00.xml`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`TISVCLOUD HTTP ${res.status}`);
    const text = await res.text();
    return parseM05AXML(text);
  }

  // 解析 M05A XML 回傳速度資料
  function parseM05AXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const sections = doc.querySelectorAll('Section, VDLive');
    const stations = [];

    sections.forEach(sec => {
      // M05A 格式：<Section> 底下有 <VehicleType typeID="31"> 一般小客車
      const sid = sec.getAttribute('SectionID') || sec.getAttribute('VDID') || '';
      const lat = parseFloat(sec.getAttribute('Latitude') || sec.getAttribute('lat') || '0');
      const lng = parseFloat(sec.getAttribute('Longitude') || sec.getAttribute('lon') || '0');

      // 取所有車種的速度，優先取 typeID=31（小客車）
      let speed = -1;
      const vtNodes = sec.querySelectorAll('VehicleType');
      vtNodes.forEach(vt => {
        const tid = vt.getAttribute('TypeID') || vt.getAttribute('typeID') || '';
        const spNode = vt.querySelector('Speed');
        if (spNode) {
          const s = parseFloat(spNode.textContent);
          if (tid === '31') speed = s;
          else if (speed < 0 && !isNaN(s) && s > 0) speed = s;
        }
      });

      // 有些格式直接在 Section 上有 Speed 屬性
      if (speed < 0) {
        const directSpeed = parseFloat(sec.getAttribute('Speed') || '-1');
        if (directSpeed > 0) speed = directSpeed;
      }

      if (lat && lng && sid) {
        stations.push({ id: sid, lat, lng, speed, level: speedToLevel(speed) });
      }
    });

    return stations;
  }

  // 主要更新函式 - 取前方路況
  async function updateConditions(position) {
    const now = Date.now();
    // 30 秒內不重複取資料
    if (now - lastFetchTime < 25000) return latestConditions;

    let stations = [];
    try {
      if (APP_CONFIG.WORKER_URL) {
        // 透過 Worker 取資料（Worker 端解析好後回傳 JSON）
        const data = await fetchViaWorker(position.lat, position.lng);
        stations = data.stations || [];
      } else {
        // 直接嘗試 TISVCLOUD（可能被 CORS 擋）
        stations = await fetchTISVCLOUD();
      }
      lastFetchTime = now;
    } catch (err) {
      console.warn('[Traffic] Fetch failed:', err.message);
      return latestConditions;
    }

    // 更新快取
    stations.forEach(s => {
      latestConditions[s.id] = s;
    });

    return latestConditions;
  }

  // 取得前方指定公里處最近的 VD 站路況
  function getConditionAtPoint(targetLat, targetLng, maxDistKm = 2.5) {
    let nearest = null;
    let minDist = Infinity;

    Object.values(latestConditions).forEach(st => {
      const d = Geo.distanceBetween(targetLat, targetLng, st.lat, st.lng);
      if (d < minDist && d <= maxDistKm) {
        minDist = d;
        nearest = st;
      }
    });

    return nearest
      ? { ...nearest, distKm: minDist }
      : { level: LEVEL.UNKNOWN, speed: -1, distKm: null };
  }

  // 取得前方 10 公里每 1 km 的路況（供色塊條用）
  function getAheadSegments(position) {
    if (!position) return Array(10).fill({ level: LEVEL.UNKNOWN });
    const segments = [];
    for (let km = 1; km <= 10; km++) {
      const pt = Geo.pointAhead(position.lat, position.lng, position.heading, km);
      const cond = getConditionAtPoint(pt.lat, pt.lng);
      segments.push({ km, ...cond });
    }
    return segments;
  }

  return {
    LEVEL,
    LEVEL_NAME,
    LEVEL_CLASS,
    speedToLevel,
    updateConditions,
    getConditionAtPoint,
    getAheadSegments,
    getLatestConditions: () => latestConditions,
  };
})();
