let DEBUG_LOG = [];
let hud;

function log(msg){
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}`;
  DEBUG_LOG.push(line);
  if (hud) hud.innerText = line;
}

function copyDebugLog(){
  navigator.clipboard.writeText(DEBUG_LOG.join("\n"));
  alert("デバッグログをコピーしました");
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// seek 完了を待つ
function seekVideo(video, time){
  return new Promise(resolve=>{
    const handler = ()=>{
      video.removeEventListener("seeked", handler);
      resolve();
    };
    video.addEventListener("seeked", handler);
    video.currentTime = time;
  });
}

// seek後、「描画できるフレームが本当に来た」ことを待つ（Androidで必須）
async function waitFrameReady(video, timeoutMs=800){
  const t0 = performance.now();
  while(true){
    // HAVE_CURRENT_DATA(2) 以上なら drawImage 可能
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return true;
    if (performance.now() - t0 > timeoutMs) return false;
    await sleep(16);
  }
}

// ===== 3D内角（nullガード付き） =====
function innerAngle3D(a,b,c){
  const ab = {x:a.x-b.x, y:a.y-b.y, z:(a.z||0)-(b.z||0)};
  const cb = {x:c.x-b.x, y:c.y-b.y, z:(c.z||0)-(b.z||0)};
  const dot = ab.x*cb.x + ab.y*cb.y + ab.z*cb.z;
  const mag = Math.hypot(ab.x,ab.y,ab.z) * Math.hypot(cb.x,cb.y,cb.z);
  const v = dot / mag;
  if (!isFinite(v)) return null;
  const clamped = Math.max(-1, Math.min(1, v));
  return Math.acos(clamped) * 180 / Math.PI;
}

// パーセンタイル（外れ値を避ける）
function percentile(arr, p){
  if(!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if(lo === hi) return a[lo];
  return a[lo] + (a[hi]-a[lo])*(idx-lo);
}

async function analyze(){
  hud = document.getElementById("hud");
  DEBUG_LOG = [];
  log("analyze() start");

  const out = document.getElementById("result");
  const file = document.getElementById("videoInput").files[0];
  if(!file){
    out.innerText = "動画を選択してください";
    log("no file");
    return;
  }

  out.innerText = "解析中…";

  // ===== 動画（seek解析専用：playしない） =====
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);

  await new Promise(resolve=>{
    video.onloadedmetadata = ()=>resolve();
  });
  // iOS/Androidで念のため最初のフレームを確定
  video.pause();

  log(`video loaded (${video.duration.toFixed(2)}s)`);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const FPS = 2;                 // 2fpsで十分
  const STEP = 1 / FPS;

  // ===== MediaPipe =====
  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    selfieMode: false
  });

  // 収集（薬指・小指の両方：あなたのindexの「pinkyグループ」に合わせる）
  const data = {
    ring:  { MCP:[], PIP:[], DIP:[], dist:[] },
    pinky: { MCP:[], PIP:[], DIP:[], dist:[] }
  };

  let attempted = 0;   // send試行フレーム
  let ok = 0;          // onResultsで手が出たフレーム

  hands.onResults(res=>{
    if(!res.multiHandLandmarks) return;
    const lm = res.multiHandLandmarks[0];

    // 正規化分母：wrist–middle MCP（距離耐性）
    const WRIST = lm[0];
    const MID_MCP = lm[9];
    const denom = Math.hypot(
      MID_MCP.x-WRIST.x,
      MID_MCP.y-WRIST.y,
      (MID_MCP.z||0)-(WRIST.z||0)
    );
    if(!isFinite(denom) || denom <= 0) return;

    // ring: 13-14-15-16 / pinky: 17-18-19-20
    const fingerDefs = {
      ring:  [13,14,15,16],
      pinky: [17,18,19,20]
    };

    for(const name of ["ring","pinky"]){
      const [mcp,pip,dip,tip] = fingerDefs[name];

      const aM = innerAngle3D(WRIST, lm[mcp], lm[pip]);       // MCP相当
      const aP = innerAngle3D(lm[mcp], lm[pip], lm[dip]);     // PIP
      const aD = innerAngle3D(lm[pip], lm[dip], lm[tip]);     // DIP
      if(aM==null || aP==null || aD==null) continue;

      data[name].MCP.push(aM);
      data[name].PIP.push(aP);
      data[name].DIP.push(aD);

      const TIP = lm[tip];
      const d = Math.hypot(
        TIP.x-WRIST.x,
        TIP.y-WRIST.y,
        (TIP.z||0)-(WRIST.z||0)
      );
      const nd = d / denom;
      if(isFinite(nd)) data[name].dist.push(nd);
    }

    ok++;
  });

  // ===== フレーム処理 =====
  // canvasサイズは一度だけ（メタデータ後に確定）
  canvas.width  = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);

  for(let t=0; t < video.duration; t += STEP){
    log(`seek ${t.toFixed(2)}s`);
    await seekVideo(video, t);

    const ready = await waitFrameReady(video, 800);
    if(!ready){
      log("frame not ready, skip");
      continue;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    attempted++;
    try{
      await hands.send({ image: canvas });
    }catch(e){
      log("hands.send failed, skip frame");
    }
  }

  log(`frames done attempted=${attempted} detected=${ok}`);

  // ===== 測定可否 =====
  // 実測：ok（手が出たフレーム）が少なすぎたら不可
  if(ok < 3){
    out.innerText = "⚠️ 測定不可（手の検出ができませんでした）\n撮影範囲・ピント・明るさを確認してください。";
    log("measurement failed: too few detections");
    return;
  }

  // ===== ROM算出（撮影角依存を減らす） =====
  // 内角は「伸展ほど大きい」ので、伸展基準＝上位（95%）をbaseline扱いにする
  // 屈曲＝baseline - 下位（5%）
  // 伸展（過伸展っぽい値）は baseline と上位（99%）の差（ノイズ分を分離）
  function romFromAngles(arr){
    const base = percentile(arr, 0.95);     // 伸展基準（最大寄り）
    const minA = percentile(arr, 0.05);     // 屈曲最大寄り
    const top  = percentile(arr, 0.99);     // ノイズ上限寄り
    if(base==null || minA==null || top==null) return null;
    const flex = Math.max(0, base - minA);
    const ext  = Math.max(0, top - base);
    return { flex, ext };
  }

  function minNormDist(arr){
    // 完全屈曲ほど小さい想定：下位1%を採用（外れ値回避）
    const v = percentile(arr, 0.01);
    return v==null ? null : v;
  }

  // ===== 出力 =====
  let html = `<b>測定完了</b><br><br>`;
  for(const name of ["ring","pinky"]){
    const d = data[name];
    if(d.MCP.length < 3){
      html += `<b>${name}</b><br>測定不可（検出不足）<br><br>`;
      continue;
    }
    const m = romFromAngles(d.MCP);
    const p = romFromAngles(d.PIP);
    const di = romFromAngles(d.DIP);
    const dist = minNormDist(d.dist);

    html += `<b>${name}</b><br>
      MCP：屈曲 ${m.flex.toFixed(1)}° / 伸展 ${m.ext.toFixed(1)}°<br>
      PIP：屈曲 ${p.flex.toFixed(1)}° / 伸展 ${p.ext.toFixed(1)}°<br>
      DIP：屈曲 ${di.flex.toFixed(1)}° / 伸展 ${di.ext.toFixed(1)}°<br>
      完全屈曲 指尖―手掌距離（正規化・無次元）： ${dist==null ? "NA" : dist.toFixed(2)}
      <br><br>`;
  }

  out.innerHTML = html;
  log("analysis finished");
  }
