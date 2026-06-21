// 路況資料取得與解析（前端直接呼叫 Worker CORS proxy）

const Traffic = (() => {
  let lastFetchTime = 0;
  let latestConditions = {};  // { [VDID]: { id, lat, lng, speed, occupancy, level } }
  let prevConditions = {};    // 上次快照，用來偵測速度趨勢

  // 廊道鎖定：偵測到使用者在哪條國道後鎖定，只顯示該廊道資料
  let lockedCorridor = null;  // e.g. 'N3-S'
  let unlockTimer = null;
  let corridorLockedAt = 0;   // timestamp，用來計算 12 分鐘強制解鎖

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

  // 從 VDID 解析廊道識別碼，例：VD-N3-S-200-M-RS → 'N3-S'
  function parseVDIDCorridor(vdid) {
    const m = vdid.match(/^VD-([A-Z]\d+)-([NSEW])-/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  // 更新廊道鎖定（每次 pollTraffic 呼叫）
  function updateCorridorLock(position) {
    if (!position) return lockedCorridor;

    // 找 1.5 km 內最近的主線 VD 站
    let nearestId = null, minDist = Infinity;
    Object.entries(latestConditions).forEach(([id, st]) => {
      const d = Geo.distanceBetween(position.lat, position.lng, st.lat, st.lng);
      if (d < minDist && d <= 1.5) { minDist = d; nearestId = id; }
    });

    if (nearestId) {
      const corridor = parseVDIDCorridor(nearestId);
      if (corridor) {
        if (corridor !== lockedCorridor) {
          console.log('[Traffic] Corridor locked:', corridor);
          lockedCorridor = corridor;
          corridorLockedAt = Date.now();
        }
        // 重置解鎖計時器：120 秒無 VD 站才解鎖
        if (unlockTimer) clearTimeout(unlockTimer);
        unlockTimer = setTimeout(() => {
          console.log('[Traffic] Corridor unlocked');
          lockedCorridor = null;
          unlockTimer = null;
        }, 120000);
      }
    } else if (lockedCorridor) {
      // 附近找不到 VD 站
      if ((position.speed || 0) < 10) {
        // 車速 < 10 km/h：可能卡在車陣中，抑制解鎖計時器
        if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
        // 但最多 12 分鐘後強制解鎖（避免下匝道後停車燈誤鎖）
        if (Date.now() - corridorLockedAt > 12 * 60 * 1000) {
          console.log('[Traffic] Force unlock after 12 min low-speed');
          lockedCorridor = null;
          corridorLockedAt = 0;
        }
      } else if (!unlockTimer) {
        // 車速正常但找不到 VD，啟動 120 秒解鎖倒數
        unlockTimer = setTimeout(() => {
          console.log('[Traffic] Corridor unlocked');
          lockedCorridor = null;
          unlockTimer = null;
        }, 120000);
      }
    }

    return lockedCorridor;
  }

  function getLockedCorridor() { return lockedCorridor; }

  function resetCorridor() {
    lockedCorridor = null;
    corridorLockedAt = 0;
    if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
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

  // 主要更新函式
  async function updateConditions(position) {
    const now = Date.now();
    if (now - lastFetchTime < 25000) return latestConditions;

    let stations = [];
    try {
      if (APP_CONFIG.WORKER_URL) {
        const data = await fetchViaWorker(position.lat, position.lng);
        stations = data.stations || [];
      }
      lastFetchTime = now;
    } catch (err) {
      console.warn('[Traffic] Fetch failed:', err.message);
      return latestConditions;
    }

    // 保存上次快照，供速度趨勢比較
    prevConditions = {};
    Object.entries(latestConditions).forEach(([id, st]) => {
      prevConditions[id] = { speed: st.speed, level: st.level };
    });

    // 更新快取（Worker 已回傳佔有率調整後的 level）
    stations.forEach(s => {
      latestConditions[s.id] = s;
    });

    return latestConditions;
  }

  // 取得指定座標點最近的 VD 站路況
  // 若已鎖定廊道，只搜尋該廊道的站位
  function getConditionAtPoint(targetLat, targetLng, maxDistKm = 2.5) {
    let nearest = null, minDist = Infinity;

    Object.values(latestConditions).forEach(st => {
      if (lockedCorridor && parseVDIDCorridor(st.id) !== lockedCorridor) return;
      const d = Geo.distanceBetween(targetLat, targetLng, st.lat, st.lng);
      if (d < minDist && d <= maxDistKm) { minDist = d; nearest = st; }
    });

    return nearest
      ? { ...nearest, distKm: minDist }
      : { level: LEVEL.UNKNOWN, speed: -1, distKm: null };
  }

  // 取得前方 10 公里每 1 km 的路況（含速度趨勢、VD 補間、急速失速旗標）
  function getAheadSegments(position) {
    if (!position) return Array(10).fill({ level: LEVEL.UNKNOWN });

    // 第一步：取原始路況
    const rawSegs = [];
    for (let km = 1; km <= 10; km++) {
      const pt = Geo.pointAhead(position.lat, position.lng, position.heading, km);
      const cond = getConditionAtPoint(pt.lat, pt.lng);

      let level = cond.level;
      let rapidDecel = false;
      if (cond.id && cond.level !== LEVEL.UNKNOWN && prevConditions[cond.id]) {
        const drop = (prevConditions[cond.id].speed || 0) - (cond.speed || 0);
        if (drop >= 30) {
          // 急速失速（ΔV ≥ 30 km/h）→ 特殊警示旗標，強制 RED
          rapidDecel = true;
          level = LEVEL.RED;
        } else if (drop >= 15) {
          level = Math.min(level + 1, LEVEL.RED);
        }
      }
      rawSegs.push({ km, ...cond, level, rapidDecel });
    }

    // 第二步：VD 空白補間
    // - 1～2 個連續灰格（夾在已知段之間）→ 填入較差的鄰段
    // - 首格（km=1）灰 + km=2 已知 → 繼承 km=2（左邊視為 UNKNOWN）
    // - 3+ 個連續灰格 → 保留灰色，不補間
    for (let i = 0; i < rawSegs.length; ) {
      if (rawSegs[i].level !== LEVEL.UNKNOWN) { i++; continue; }

      let runEnd = i;
      while (runEnd < rawSegs.length && rawSegs[runEnd].level === LEVEL.UNKNOWN) runEnd++;
      const runLength = runEnd - i;

      if (runLength <= 2) {
        const leftLevel  = i > 0       ? rawSegs[i - 1].level  : LEVEL.UNKNOWN;
        const rightLevel = runEnd < rawSegs.length ? rawSegs[runEnd].level : LEVEL.UNKNOWN;
        if (leftLevel !== LEVEL.UNKNOWN || rightLevel !== LEVEL.UNKNOWN) {
          const useLeft  = leftLevel >= rightLevel;
          const fillLevel = useLeft ? leftLevel : rightLevel;
          const fillSrc  = useLeft ? rawSegs[i - 1] : rawSegs[runEnd];
          for (let j = i; j < runEnd; j++) {
            rawSegs[j] = { ...rawSegs[j], level: fillLevel, speed: fillSrc.speed };
          }
        }
      }
      // 3+ 連續灰格 → 不動

      i = runEnd;
    }

    return rawSegs;
  }

  // 解析 VDID 取得路名，例：VD-N1-N-86.120-M-LOOP → 「國道1號 北向 86K」
  function parseVDID(vdid) {
    const m = vdid.match(/^VD-([A-Z]\d+)-([NSEW])-(\d+(?:\.\d+)?)-M-/);
    if (!m) return null;
    const routeMap = {
      N1:'國道1號', N2:'國道2號', N3:'國道3號',
      N4:'國道4號', N5:'國道5號', N6:'國道6號',
      N8:'國道8號', N10:'國道10號',
    };
    const dirMap = { N:'北向', S:'南向', E:'東向', W:'西向' };
    const route = routeMap[m[1]] || m[1];
    const dir   = dirMap[m[2]]   || m[2];
    const km    = Math.round(parseFloat(m[3]));
    return `${route} ${dir} ${km}K`;
  }

  // 取得路名：廊道鎖定時搜尋範圍放寬到 5km，未鎖定則 2km 內才顯示
  function getNearestRoadName(position) {
    const searchDist = lockedCorridor ? 5.0 : 2.0;
    let nearest = null, minDist = Infinity;

    Object.entries(latestConditions).forEach(([id, st]) => {
      if (lockedCorridor) {
        if (parseVDIDCorridor(id) !== lockedCorridor) return;
      }
      const d = Geo.distanceBetween(position.lat, position.lng, st.lat, st.lng);
      if (d < minDist && d <= searchDist) { minDist = d; nearest = id; }
    });

    return nearest ? parseVDID(nearest) : null;
  }

  return {
    LEVEL,
    LEVEL_NAME,
    LEVEL_CLASS,
    speedToLevel,
    updateConditions,
    updateCorridorLock,
    getLockedCorridor,
    resetCorridor,
    getConditionAtPoint,
    getAheadSegments,
    getLatestConditions: () => latestConditions,
    getNearestRoadName,
  };
})();
