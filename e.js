// ===== ROM / BUILD =====
const ROM_ID = "12ROM";
log("Analyze.js loaded (12ROM v1.0.1)");
log("BUILD " + new Date().toISOString());

function analyze() {
  log("analyze() start");
  log(`ROM=${ROM_ID} VER=v1.0.1`);

  if (!window.lastLandmarks) {
    log("No landmarks");
    return;
  }

  // ===== 角度配列取得（既存ロジックそのまま）=====
  // ※ ここはあなたの元コードを一切削っていません
  const results = calculateJointAngles(window.lastLandmarks);

  results.forEach(joint => {
    const angles = joint.angles;

    if (!angles || angles.length === 0) return;

    // ===== 修正された角度定義 =====
    const flex = Math.max(...angles) - Math.min(...angles);
    const ext  = Math.max(0, Math.max(...angles) - 180);

    joint.flexion = flex;
    joint.extension = ext;
  });

  outputResults(results);
}

// ===== 10回自動測定 =====
function analyzeRepeat(n = 10, interval = 300) {
  let i = 0;
  log(`Repeat analyze start (${n} times)`);
  const timer = setInterval(() => {
    if (i >= n) {
      clearInterval(timer);
      log("Repeat analyze finished");
      return;
    }
    analyze();
    i++;
  }, interval);
}
