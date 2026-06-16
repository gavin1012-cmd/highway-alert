// 警示邏輯：路況比較、語音播報、冷卻管理

const Alert = (() => {
  // 各路段上次警示狀態 { sectionId: { level, lastAlertTime } }
  const sectionState = {};

  // 語音播報
  function speak(text) {
    if (!window.speechSynthesis) return;
    if (!document.getElementById('notifyVoice')?.checked) return;

    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-TW';
    utter.rate = 0.9;
    utter.volume = 1.0;

    // iOS Safari 需要在使用者互動後才能播放，這裡靠使用者按開始監控觸發
    speechSynthesis.speak(utter);
  }

  // 路況描述文字
  function levelToText(level) {
    return Traffic.LEVEL_NAME[level] || '未知';
  }

  // 建構警示訊息
  function buildMessage(segment, currentLevel) {
    const dist = segment.km;
    const levelText = levelToText(currentLevel);
    const speed = segment.speed > 0 ? `，速度約 ${Math.round(segment.speed)} 公里` : '';
    return `前方 ${dist} 公里${levelText}${speed}，請注意`;
  }

  // 敏感度設定：'yellow' = 黃以上, 'orange' = 橘以上
  function getSensitivity() {
    const el = document.querySelector('input[name="sensitivity"]:checked');
    return el?.value || APP_CONFIG.ALERT.SENSITIVITY || 'orange';
  }

  // 檢查是否應觸發警示
  function shouldAlert(sectionId, newLevel) {
    const sensitivity = getSensitivity();
    const threshold = sensitivity === 'yellow' ? Traffic.LEVEL.YELLOW : Traffic.LEVEL.ORANGE;

    // 路況未達警示等級
    if (newLevel < threshold) return false;

    const prev = sectionState[sectionId];
    if (!prev) return true; // 首次見到此路段，若已達等級則警示

    // 冷卻時間內不重複警示
    const now = Date.now();
    if (now - prev.lastAlertTime < APP_CONFIG.ALERT.COOLDOWN_MS) return false;

    // 路況未變差則不警示
    if (newLevel <= prev.level) return false;

    return true;
  }

  // 處理前方路段更新（由 main.js 呼叫）
  function checkSegments(segments) {
    const triggered = [];

    segments.forEach(seg => {
      if (seg.level === Traffic.LEVEL.UNKNOWN) return;

      const sid = `km_${seg.km}`;
      const newLevel = seg.level;

      if (shouldAlert(sid, newLevel)) {
        // 更新狀態
        sectionState[sid] = { level: newLevel, lastAlertTime: Date.now() };

        const message = buildMessage(seg, newLevel);
        triggered.push({ km: seg.km, level: newLevel, message, segment: seg });

        // 語音播報（螢幕亮時）
        speak(message);
      } else if (sectionState[sid]) {
        // 路況改善時更新狀態（不觸發警示）
        if (newLevel < sectionState[sid].level) {
          sectionState[sid].level = newLevel;
        }
      } else {
        // 初次記錄（路況良好，不警示）
        sectionState[sid] = { level: newLevel, lastAlertTime: 0 };
      }
    });

    return triggered;
  }

  // 重置所有狀態（停止監控時使用）
  function reset() {
    Object.keys(sectionState).forEach(k => delete sectionState[k]);
  }

  return { checkSegments, speak, reset, levelToText };
})();
