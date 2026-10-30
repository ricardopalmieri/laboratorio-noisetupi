(() => {
  "use strict";

  const VERSION = "2.8.0";
  const DB_NAME = "nt-sampler-v2";
  const DB_VERSION = 1;
  const PROGRAM_COUNT = 8;
  const PAD_COUNT = 16;
  const PATTERN_SLOT_COUNT = 99;
  const AUDIO_EXTENSIONS = new Set(["wav","mp3","m4a","aac","flac","ogg","opus","webm"]);
  const THEMES = new Set(["red-nt","ocean","minimal","minimal-invert"]);
  const safeStorageGet = (key,fallback="") => { try { const v=localStorage.getItem(key); return v===null?fallback:v; } catch { return fallback; } };
  const safeStorageSet = (key,value) => { try { localStorage.setItem(key,String(value)); return true; } catch { return false; } };
  const safeStorageRemove = key => { try { localStorage.removeItem(key); } catch {} };
  const storedThemePreference = () => { const v=safeStorageGet("nt-sampler-theme","red-nt"); return THEMES.has(v)?v:"red-nt"; };
  let activeTheme = storedThemePreference();
  const PAD_FX_KEYS = ["drive","delay","reverb","stutter","scatter","glitch","oscBot","patternSlicer","stepSlicer"];
  const MASTER_FX_KEYS = ["filter","drive","delay","reverb","stutter","scatter","glitch","oscBot","patternSlicer","stepSlicer","eq","compressor","limiter"];
  const KEY_CODES = ["Digit1","Digit2","Digit3","Digit4","KeyQ","KeyW","KeyE","KeyR","KeyA","KeyS","KeyD","KeyF","KeyZ","KeyX","KeyC","KeyV"];
  const QUANTIZE = { off: 0, "1/4": 1, "1/8": 2, "1/16": 4, "1/32": 8 };
  const STOP_FADE = .04; // de-click local: 40 ms, inspirado no comportamento consolidado do NT Looper
  const MIN_GATE_AUDIBLE = .026; // toque MIDI muito curto ainda produz um pulso audível, sem deixar voz presa
  const MIDI_PAD_DEBOUNCE_MS = 18; // filtra Note On/CC duplicado comum em bridges/controladores iOS
  const app = document.querySelector("#app");
  const audioInput = document.querySelector("#local-audio-input");
  const projectInput = document.querySelector("#project-input");
  const folderInput = document.querySelector("#local-folder-input");

  const defaultPadFx = () => ({
    drive:{on:false,amount:.18}, delay:{on:false,mix:.18,division:"1/8",feedback:.28}, reverb:{on:false,mix:.18,size:1.5},
    stutter:{on:false,division:"1/16",depth:.9},
    scatter:{on:false,mix:.62,rate:4,depth:.82,pattern:0},
    glitch:{on:false,mix:.48,bits:8,hold:3,dropout:.08},
    oscBot:{on:false,mix:.55,dryInput:0,wave:0,tone:0,attack:50,note:36,sens:0,balance:.72,seqOn:1,seqSync:1,seqRate:2,seqSteps:16,seqGate:.68,step0:0,step1:0,step2:7,step3:0,step4:3,step5:0,step6:10,step7:7,step8:0,step9:12,step10:7,step11:3,step12:0,step13:-5,step14:3,step15:7},
    patternSlicer:{on:false,mix:1,pattern:0,rate:4,duty:.5,attack:.02,depth:.85},
    stepSlicer:{on:false,mix:1,rate:4,depth:.85,step0:1,step1:.18,step2:1,step3:.18,step4:1,step5:.18,step6:1,step7:.18,step8:1,step9:.18,step10:1,step11:.18,step12:1,step13:.18,step14:1,step15:.18}
  });
  const emptyPad = () => ({
    source:null, mode:"oneshot", triggerMode:"quantize", start:0, end:null, gainDb:0, pitch:0, pan:0,
    attack:.002, release:.03, cutoff:20000, resonance:.7, reverse:false,
    originalBpm:null, bpmConfidence:0, tempoSync:false, stretch:1, fx:defaultPadFx(), fxChain:[]
  });
  const emptyPattern = (beats = 4, name = "") => ({ name, beats, events: Array.from({ length: beats * 4 }, () => []) });
  const emptyProgram = (index) => { const first=emptyPattern(4,"PATTERN 01"); return { name: `PROGRAM ${String(index + 1).padStart(2,"0")}`, muted:false, soloed:false, volumeDb:0, pads: Array.from({length: PAD_COUNT}, emptyPad), activePattern:0, patterns:{0:first}, pattern:first }; };
  const defaultFx = () => ({
    filter: { on:false, cutoff:20000 }, drive: { on:false, amount:0 },
    delay: { on:false, mix:.18, division:"1/8", feedback:.28 },
    reverb: { on:false, mix:.18, size:1.8 }, stutter: { on:false, division:"1/16", depth:.9 },
    oscBot: { on:false, mix:.55, dryInput:0, wave:0, tone:0, attack:50, note:36, sens:0, balance:.72, seqOn:1, seqSync:1, seqRate:2, seqSteps:16, seqGate:.68,
      step0:0,step1:0,step2:7,step3:0,step4:3,step5:0,step6:10,step7:7,step8:0,step9:12,step10:7,step11:3,step12:0,step13:-5,step14:3,step15:7 },
    scatter: { on:false, mix:.55, rate:4, depth:.8, pattern:0 },
    glitch: { on:false, mix:.42, bits:8, hold:3, dropout:.06 },
    patternSlicer: { on:false, mix:1, pattern:0, rate:4, duty:.5, attack:.02, depth:.85 },
    stepSlicer: { on:false, mix:1, rate:4, depth:.85, step0:1,step1:.18,step2:1,step3:.18,step4:1,step5:.18,step6:1,step7:.18,step8:1,step9:.18,step10:1,step11:.18,step12:1,step13:.18,step14:1,step15:.18 },
    eq: { on:false, low:0, lowMid:0, highMid:0, high:0 },
    compressor: { on:false, threshold:-12, ratio:2, attack:.012, release:.16, makeup:0 },
    limiter: { on:true, ceiling:-1, release:.08 },
    masterDb: -1
  });
  const makeState = () => ({
    started:false, tab:"library", selectedPad:0, currentProgram:0,
    programs:Array.from({length:PROGRAM_COUNT},(_,i)=>emptyProgram(i)),
    serverFiles:[], localFiles:[], search:"", message:"", messageKind:"",
    tempo:120, quantize:"1/16", transport:false, patternRecord:false, fx:defaultFx(), fxChain:["limiter"],
    libraryFolders:[], assetFolders:{}, currentFolder:"*", librarySource:"all", librarySort:"name", collapsedFolders:[],
    editor:null, modal:null, moveIds:[], pendingLoads:new Set(), previewKey:null, previewProgress:0, projectName:"UNTITLED",
    theme:activeTheme, sideHidden:safeStorageGet("nt-sampler-side-hidden")==="1"
  });
  let state = makeState();

  let dbPromise = null;
  let audioCtx = null;
  let masterInput = null;
  let masterHeadroom = null;
  let masterFilter = null;
  let driveNode = null;
  let masterGate = null;
  let eqLow = null;
  let eqLowMid = null;
  let eqHighMid = null;
  let eqHigh = null;
  let compressor = null;
  let compressorMakeup = null;
  let limiter = null;
  let masterGain = null;
  let analyser = null;
  let reverbInput = null;
  let convolver = null;
  let reverbDry = null;
  let reverbWet = null;
  let reverbOut = null;
  let delayInput = null;
  let delayNode = null;
  let delayFeedback = null;
  let delayDry = null;
  let delayWet = null;
  let delayOut = null;
  let masterImpulseTimer = null;
  let recordDestination = null;
  let mediaRecorder = null;
  let recordChunks = [];
  let recordingStartedAt = 0;
  let pendingMasterExport = null;
  let masterPerfNode = null;
  let patternSlicerFx = null;
  let stepSlicerFx = null;
  let oscBotFx = null;
  let scatterFx = null;
  let glitchFx = null;
  let workletsReady = false;
  let workletsPromise = null;
  let audioDevices = { inputs:[], outputs:[], selectedInput:safeStorageGet("nt-sampler-audio-input"), selectedOutput:safeStorageGet("nt-sampler-audio-output") };
  let midiAccess = null;
  let midiInput = null;
  let midiInputs = [];
  let midiLearnTarget = null;
  let keyboardLearnTarget = null;
  let visualLearnMode = null;
  let visualLearnRemove = false;
  let visualLearnArmed = null;
  let mappingPaint = null;
  const midiMappings = loadStoredMap("nt-sampler-midi-map", {});
  const keyboardMappings = loadStoredMap("nt-sampler-keyboard-map", null) || Object.fromEntries(KEY_CODES.map((code,index)=>[code,{actionId:`pad_${index}`,label:`PAD ${String(index+1).padStart(2,"0")}`}]));
  const downMappedKeys = new Map();
  const downMappedMidi = new Map();
  const midiPadLastPress = new Map();
  const gatePressState = new Map();

  const bufferCache = new Map();
  const reverseCache = new Map();
  const localBlobCache = new Map();
  const waveformCache = new Map();
  const waveformPending = new Set();
  const padFxFocus = new Map();
  let masterFxFocus = null;
  const uiRefs = { masterMeter:null, position:null, padProgress:[], programMeters:[], latency:[] };
  let masterMeterData = null;
  let lastUiVisualFrame = 0;
  let lastUiMeterFrame = 0;
  let lastUiReadoutFrame = 0;
  const padVoices = new Map();
  const programBuses = new Map();
  const programMeters = new Map();
  const patternPreviewVoices = new Map();
  const librarySelection = new Set();
  const transformedBufferCache = new Map();
  const loopRefreshTimers = new Map();
  const transformRefreshGeneration = new Map();
  // LOOP is a true latch/toggle. Keep intent separate from voice lifetime so a MIDI
  // Note On can cancel a pending start before the transformed buffer is ready.
  const loopToggleDesired = new Map();
  const loopToggleGeneration = new Map();
  const padFxRacks = new Map();
  const impulseCache = new Map();
  let previewVoice = null;
  let previewMeta = null;
  let audioUnlockDone = false;
  let audioUnlockInFlight = null;
  let iosAudioPrime = null;
  let touchLibraryDrag = null;
  let transportOrigin = 0;
  let masterClockOrigin = 0;
  let schedulerTimer = null;
  let nextStepTime = 0;
  let nextStepIndex = 0; // global 1/16 step index, independent from the selected program
  let transportEpoch = 0;
  const transportPrograms = new Set();
  const transportProgramGeneration = Array.from({length:PROGRAM_COUNT},()=>0);
  let scheduledUiSteps = [];
  let currentUiStep = 0;
  let tapTimes = [];
  let saveTimer = null;
  let lastMeter = 0;
  let lastProgramMeterAt = 0;
  const HISTORY_LIMIT = 60;
  const undoStack = [];
  const redoStack = [];

  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const dbToGain = db => Math.pow(10, db / 20);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtTime = sec => {
    sec = Math.max(0, Number(sec) || 0);
    const min = Math.floor(sec/60), s = Math.floor(sec%60), ms = Math.floor((sec%1)*1000);
    return `${String(min).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
  };
  const fmtShort = sec => `${Math.floor(sec)}.${String(Math.floor((sec%1)*1000)).padStart(3,"0")}s`;
  const fmtBytes = n => !n ? "" : n < 1048576 ? `${Math.round(n/1024)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const sourceKey = source => source ? `${source.kind}:${source.id || source.url || source.name}` : "";
  const currentProgram = () => state.programs[state.currentProgram];
  const selectedPad = () => currentProgram().pads[state.selectedPad];
  function loadStoredMap(key,fallback){try{const raw=safeStorageGet(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
  function saveStoredMap(key,value){safeStorageSet(key,JSON.stringify(value));}
  function humanKey(code){return String(code||"").replace(/^Key/,"").replace(/^Digit/,"").replace("Arrow","ARROW ").toUpperCase();}
  function normalizeFolder(path){return String(path||"").replace(/\\/g,"/").split("/").map(v=>v.trim()).filter(v=>v&&v!==".").join("/").slice(0,180);}
  function folderOfFile(file){const rel=String(file?.webkitRelativePath||"").replace(/\\/g,"/");if(rel.includes("/"))return normalizeFolder(rel.slice(0,rel.lastIndexOf("/")));return state.currentFolder!=="*"?normalizeFolder(state.currentFolder):"";}
  function registerFolder(path){path=normalizeFolder(path);if(!path)return;const parts=path.split("/");for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join("/");if(!state.libraryFolders.includes(p))state.libraryFolders.push(p);}state.libraryFolders.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));}
  function audioExtension(name){const m=String(name||"").toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:"";}
  function isSupportedAudio(item){return !!item&&AUDIO_EXTENSIONS.has(audioExtension(item.name));}
  function applyThemeState(){
    // Theme has exactly one DOM owner: <html>. No application container or control shares this attribute.
    // This prevents bubbled change events from ever being interpreted as a theme change.
    if(!THEMES.has(activeTheme))activeTheme="red-nt";
    state.theme=activeTheme;
    const root=document.documentElement;
    if(root.dataset.theme!==activeTheme)root.dataset.theme=activeTheme;
  }
  function setTheme(theme){
    activeTheme=THEMES.has(theme)?theme:"red-nt";state.theme=activeTheme;
    safeStorageSet("nt-sampler-theme",activeTheme);
    applyThemeState();
  }
  function toggleSidePanel(){state.sideHidden=!state.sideHidden;safeStorageSet("nt-sampler-side-hidden",state.sideHidden?"1":"0");renderMain();}

  function notice(message, kind = "", transient = false) {
    state.message = message; state.messageKind = kind;
    const el = document.querySelector("[data-message]");
    if (el) { el.textContent = message; el.className = `message ${kind}`; }
    if (transient) setTimeout(() => { if (state.message === message) { state.message=""; state.messageKind=""; const e=document.querySelector("[data-message]"); if(e)e.textContent=""; } }, 2600);
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets", { keyPath:"id" });
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath:"key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function idbPut(store,value) { const db=await openDb(); return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);}); }
  async function idbGet(store,key) { const db=await openDb(); return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
  async function idbGetAll(store) { const db=await openDb(); return new Promise((res,rej)=>{const r=db.transaction(store,"readonly").objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);}); }
  async function idbDelete(store,key) { const db=await openDb(); return new Promise((res,rej)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);}); }

  function serializableState() {
    return {
      version: VERSION, projectName:state.projectName, tempo:state.tempo, quantize:state.quantize,
      currentProgram:state.currentProgram, selectedPad:state.selectedPad, programs:state.programs, fx:state.fx, fxChain:state.fxChain,
      libraryFolders:state.libraryFolders, assetFolders:state.assetFolders, collapsedFolders:state.collapsedFolders
    };
  }
  function queueAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => idbPut("state", {key:"autosave", data:serializableState()}).catch(()=>{}), 250);
  }
  function historySnapshot() {
    return JSON.parse(JSON.stringify({ projectName:state.projectName, tempo:state.tempo, quantize:state.quantize, programs:state.programs, fx:state.fx, fxChain:state.fxChain, libraryFolders:state.libraryFolders, assetFolders:state.assetFolders, collapsedFolders:state.collapsedFolders }));
  }
  function pushHistory() {
    undoStack.push(historySnapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }
  function resetHistory() { undoStack.length=0; redoStack.length=0; updateUndoRedoButtons(); }
  function restoreHistorySnapshot(snapshot) {
    const keepProgram=state.currentProgram, keepPad=state.selectedPad;
    applySaved({...snapshot,currentProgram:keepProgram,selectedPad:keepPad});
    syncAllActiveVoicesToState();
    updateAudioFx(true);
    queueAutosave();
    renderMain();
  }
  function undoAction() {
    if(!undoStack.length)return;
    redoStack.push(historySnapshot());
    restoreHistorySnapshot(undoStack.pop());
  }
  function redoAction() {
    if(!redoStack.length)return;
    undoStack.push(historySnapshot());
    restoreHistorySnapshot(redoStack.pop());
  }
  function updateUndoRedoButtons(){
    const u=document.querySelector("[data-undo]"),r=document.querySelector("[data-redo]");
    if(u)u.disabled=!undoStack.length; if(r)r.disabled=!redoStack.length;
  }
  function checkpointControl(el){ if(!el.dataset.historyTaken){pushHistory();el.dataset.historyTaken="1";} }
  function releaseControlCheckpoint(el){ delete el.dataset.historyTaken; }
  function isEditableTarget(target){ return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'); }
  function normalizePad(pad={}) {
    const base=emptyPad(), rawFx=pad.fx||{};
    const fx={...defaultPadFx(),...rawFx,drive:{...defaultPadFx().drive,...(rawFx.drive||{})},delay:{...defaultPadFx().delay,...(rawFx.delay||{})},reverb:{...defaultPadFx().reverb,...(rawFx.reverb||{})},stutter:{...defaultPadFx().stutter,...(rawFx.stutter||{})},scatter:{...defaultPadFx().scatter,...(rawFx.scatter||{})},glitch:{...defaultPadFx().glitch,...(rawFx.glitch||{})},oscBot:{...defaultPadFx().oscBot,...(rawFx.oscBot||{})},patternSlicer:{...defaultPadFx().patternSlicer,...(rawFx.patternSlicer||{})},stepSlicer:{...defaultPadFx().stepSlicer,...(rawFx.stepSlicer||{})}};
    const fxChain=Array.isArray(pad.fxChain)?pad.fxChain.filter(k=>PAD_FX_KEYS.includes(k)):PAD_FX_KEYS.filter(k=>fx[k]?.on);
    return { ...base, ...pad, fx, fxChain:[...new Set(fxChain)], mode:["oneshot","gate","loop"].includes(pad.mode)?pad.mode:"oneshot", triggerMode:["quantize","free"].includes(pad.triggerMode)?pad.triggerMode:"quantize",
      start:Number.isFinite(pad.start)?Math.max(0,pad.start):0, end:Number.isFinite(pad.end)?pad.end:null,
      gainDb:clamp(Number(pad.gainDb)||0,-36,12), pitch:clamp(Number(pad.pitch)||0,-24,24), pan:clamp(Number(pad.pan)||0,-1,1),
      attack:clamp(Number(pad.attack)||.002,0,.5), release:clamp(Number(pad.release)||.03,.002,2), cutoff:clamp(Number(pad.cutoff)||20000,80,20000),
      resonance:clamp(Number(pad.resonance)||.7,.1,18), reverse:!!pad.reverse,
      originalBpm:Number.isFinite(Number(pad.originalBpm))?clamp(Number(pad.originalBpm),30,300):null, bpmConfidence:clamp(Number(pad.bpmConfidence)||0,0,1),
      tempoSync:!!pad.tempoSync, stretch:clamp(Number(pad.stretch)||1,.5,2)
    };
  }
  function normalizePattern(pattern={}) {
    const legacyBeats = Number(pattern.bars) ? Number(pattern.bars)*4 : 4;
    const beats = clamp(Math.round(Number(pattern.beats)||legacyBeats),1,64);
    const len = beats*4;
    const events = Array.from({length:len},(_,i)=>Array.isArray(pattern.events?.[i])?pattern.events[i].filter(n=>Number.isInteger(n)&&n>=0&&n<PAD_COUNT):[]);
    return {name:String(pattern.name||"").slice(0,32),beats,events};
  }
  function normalizeProgram(raw,index){
    const p=raw||emptyProgram(index),activePattern=clamp(Math.round(Number(p.activePattern)||0),0,PATTERN_SLOT_COUNT-1),patterns={};
    if(p.patterns&&typeof p.patterns==="object")for(const [k,v] of Object.entries(p.patterns)){const n=Number(k);if(Number.isInteger(n)&&n>=0&&n<PATTERN_SLOT_COUNT&&v)patterns[n]=normalizePattern(v);}
    if(!patterns[activePattern])patterns[activePattern]=normalizePattern(p.pattern||emptyPattern(4,`PATTERN ${String(activePattern+1).padStart(2,"0")}`));
    for(const [k,v] of Object.entries(patterns))if(!v.name)v.name=`PATTERN ${String(Number(k)+1).padStart(2,"0")}`;
    return {name:String(p.name||`PROGRAM ${String(index+1).padStart(2,"0")}`).slice(0,32),muted:!!p.muted,soloed:!!p.soloed,volumeDb:clamp(Number(p.volumeDb)||0,-48,6),pads:Array.from({length:PAD_COUNT},(_,j)=>normalizePad(p.pads?.[j])),activePattern,patterns,pattern:patterns[activePattern]};
  }
  function activePattern(program=currentProgram()){
    if(!program.patterns||typeof program.patterns!=="object")program.patterns={};
    const idx=clamp(Math.round(Number(program.activePattern)||0),0,PATTERN_SLOT_COUNT-1);program.activePattern=idx;
    if(!program.patterns[idx])program.patterns[idx]=emptyPattern(4,`PATTERN ${String(idx+1).padStart(2,"0")}`);
    program.pattern=program.patterns[idx];return program.pattern;
  }
  function selectPatternSlot(index,{copy=false}={}){
    const program=currentProgram(),next=clamp(Math.round(Number(index)||0),0,PATTERN_SLOT_COUNT-1);if(next===program.activePattern&&!copy)return;
    pushHistory();const from=activePattern(program);program.activePattern=next;
    if(copy)program.patterns[next]=normalizePattern(JSON.parse(JSON.stringify(from)));
    if(!program.patterns[next])program.patterns[next]=emptyPattern(from.beats||4,`PATTERN ${String(next+1).padStart(2,"0")}`);
    program.pattern=program.patterns[next];state.patternRecord=false;queueAutosave();renderMain();
  }
  function launchPatternSlot(index){const wasTransport=state.transport;selectPatternSlot(index);if(wasTransport)updateStepUi(currentUiStep);}
  function duplicatePatternTo(index){const program=currentProgram(),source=program.activePattern,target=clamp(Math.round(Number(index)||0),0,PATTERN_SLOT_COUNT-1);if(target===source){notice("Escolha outro slot para duplicar.","warn",true);return;}if(program.patterns?.[target]){notice(`PTN ${String(target+1).padStart(2,"0")} já existe. Escolha um slot vazio.`,"warn",true);return;}selectPatternSlot(target,{copy:true});notice(`PTN ${String(source+1).padStart(2,"0")} copiado para ${String(target+1).padStart(2,"0")}.`,"ok",true);}
  function suggestedDuplicateTarget(program=currentProgram()){for(let n=1;n<PATTERN_SLOT_COUNT;n++){const idx=(program.activePattern+n)%PATTERN_SLOT_COUNT;if(!program.patterns?.[idx])return idx;}return (program.activePattern+1)%PATTERN_SLOT_COUNT;}
  function renameCurrentPattern(name){const p=activePattern();const clean=String(name||"").trim().slice(0,32)||`PATTERN ${String(currentProgram().activePattern+1).padStart(2,"0")}`;if(p.name===clean)return;p.name=clean;queueAutosave();renderMain();}
  function applySaved(data) {
    if (!data || typeof data !== "object") return;
    state.projectName = String(data.projectName || state.projectName).slice(0,48);
    state.tempo = clamp(Number(data.tempo)||120,40,240);
    state.quantize = QUANTIZE[data.quantize] !== undefined ? data.quantize : "1/16";
    state.currentProgram = clamp(Number(data.currentProgram)||0,0,PROGRAM_COUNT-1);
    state.selectedPad = clamp(Number(data.selectedPad)||0,0,PAD_COUNT-1);
    state.libraryFolders = Array.isArray(data.libraryFolders) ? [...new Set(data.libraryFolders.map(normalizeFolder).filter(Boolean))] : (state.libraryFolders||[]);
    state.collapsedFolders = Array.isArray(data.collapsedFolders) ? [...new Set(data.collapsedFolders.map(normalizeFolder).filter(Boolean))] : (state.collapsedFolders||[]);
    state.assetFolders = data.assetFolders && typeof data.assetFolders === "object" ? {...data.assetFolders} : (state.assetFolders||{});
    if(state.currentFolder!=="*"&&!state.libraryFolders.includes(state.currentFolder))state.currentFolder="*";
    if (Array.isArray(data.programs)) state.programs = Array.from({length:PROGRAM_COUNT},(_,i)=>normalizeProgram(data.programs[i],i));
    state.fxChain = Array.isArray(data.fxChain)?[...new Set(data.fxChain.filter(k=>MASTER_FX_KEYS.includes(k)))]:MASTER_FX_KEYS.filter(k=>data.fx?.[k]?.on);
    state.fx = { ...defaultFx(), ...(data.fx||{}), filter:{...defaultFx().filter,...(data.fx?.filter||{})}, drive:{...defaultFx().drive,...(data.fx?.drive||{})}, delay:{...defaultFx().delay,...(data.fx?.delay||{})}, reverb:{...defaultFx().reverb,...(data.fx?.reverb||{})}, stutter:{...defaultFx().stutter,...(data.fx?.stutter||{})}, scatter:{...defaultFx().scatter,...(data.fx?.scatter||{})}, glitch:{...defaultFx().glitch,...(data.fx?.glitch||{})}, oscBot:{...defaultFx().oscBot,...(data.fx?.oscBot||{})}, patternSlicer:{...defaultFx().patternSlicer,...(data.fx?.patternSlicer||{})}, stepSlicer:{...defaultFx().stepSlicer,...(data.fx?.stepSlicer||{})}, eq:{...defaultFx().eq,...(data.fx?.eq||{})}, compressor:{...defaultFx().compressor,...(data.fx?.compressor||{})}, limiter:{...defaultFx().limiter,...(data.fx?.limiter||{})} };
    // 2.6.0 shipped with a fairly aggressive broadband compressor enabled by default.
    // Bass-heavy material could drive gain reduction for the whole mix and make highs sound recessed.
    if(String(data.version||"")==="2.6.0"){
      const c=data.fx?.compressor;
      if(c?.on===true && Number(c.threshold)===-18 && Number(c.ratio)===3 && Math.abs(Number(c.attack)-.01)<1e-6 && Math.abs(Number(c.release)-.18)<1e-6 && Number(c.makeup||0)===0){
        state.fx.compressor={...defaultFx().compressor,on:false};
      }
    }
    for(let i=0;i<PROGRAM_COUNT;i++)if(programBuses.has(i)){applyProgramMute(i,true);applyProgramVolume(i,true);}
  }

  function getContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      try { audioCtx = new Ctx({ latencyHint:"interactive" }); } catch { audioCtx = new Ctx(); }
      buildAudioGraph();
    }
    if(state.started&&audioCtx.state==="suspended"&&!isIOSLike())audioCtx.resume().catch(()=>{});
    return audioCtx;
  }
  function isIOSLike(){return /iPad|iPhone|iPod/i.test(navigator.userAgent||"")||(navigator.platform==="MacIntel"&&Number(navigator.maxTouchPoints)>1);}
  function isIOSWebMidiHost(){return isIOSLike()&&!!midiRequestFunction();}
  function preferPlaybackAudioSession(){
    try{if(navigator.audioSession&&"type" in navigator.audioSession)navigator.audioSession.type="playback";}catch{}
  }
  function primeIOSMediaAudio(){
    if(!isIOSLike())return;
    try{
      if(!iosAudioPrime){iosAudioPrime=new Audio('data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA');iosAudioPrime.setAttribute("playsinline","");iosAudioPrime.preload="auto";iosAudioPrime.volume=1;}
      iosAudioPrime.currentTime=0;const p=iosAudioPrime.play();if(p?.catch)p.catch(()=>{});setTimeout(()=>{try{iosAudioPrime.pause();iosAudioPrime.currentTime=0;}catch{}},90);
    }catch{}
  }
  async function ensureAudioReady({gesture=false,force=false}={}){
    const ctx=getContext();preferPlaybackAudioSession();if(gesture&&(!audioUnlockDone||ctx.state!=="running"||force))primeIOSMediaAudio();
    if(audioUnlockInFlight&&!force)return audioUnlockInFlight;
    audioUnlockInFlight=(async()=>{
      try{if(ctx.state!=="running")await ctx.resume();}catch{}
      if((gesture||force||!audioUnlockDone)&&ctx.state==="running"){
        try{
          const src=ctx.createBufferSource(),gain=ctx.createGain(),buf=ctx.createBuffer(1,8,ctx.sampleRate);
          gain.gain.value=0.000001;src.buffer=buf;src.connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+.01);
        }catch{}
        audioUnlockDone=true;
      }
      return ctx.state==="running";
    })();
    try{return await audioUnlockInFlight;}finally{audioUnlockInFlight=null;}
  }

  function makeDriveCurve(amount=0) {
    const samples=2048, curve=new Float32Array(samples), k=clamp(amount,0,1)*90;
    for(let i=0;i<samples;i++){const x=i*2/samples-1;curve[i]=(1+k)*x/(1+k*Math.abs(x));}
    return curve;
  }
  function makeImpulse(seconds=1.8) {
    const ctx=getContext(), key=`${ctx.sampleRate}:${Number(seconds).toFixed(2)}`;
    if(impulseCache.has(key))return impulseCache.get(key);
    const length=Math.max(1,Math.floor(ctx.sampleRate*seconds)), impulse=ctx.createBuffer(2,length,ctx.sampleRate);
    for(let c=0;c<2;c++){const data=impulse.getChannelData(c);for(let i=0;i<length;i++){const env=Math.pow(1-i/length,2.7);data[i]=(Math.random()*2-1)*env;}}
    impulseCache.set(key,impulse);if(impulseCache.size>8)impulseCache.delete(impulseCache.keys().next().value);return impulse;
  }
  function buildAudioGraph() {
    const ctx=audioCtx;
    masterInput=ctx.createGain(); masterHeadroom=ctx.createGain(); masterHeadroom.gain.value=.72;
    masterFilter=ctx.createBiquadFilter(); masterFilter.type="lowpass";
    driveNode=ctx.createWaveShaper(); driveNode.oversample="2x"; masterGate=ctx.createGain();

    // Time FX are true serial dry/wet stages. They never feed back into masterInput,
    // which avoids the accidental recursive bus that caused clipping in 2.4.
    delayInput=ctx.createGain(); delayNode=ctx.createDelay(2); delayFeedback=ctx.createGain(); delayDry=ctx.createGain(); delayWet=ctx.createGain(); delayOut=ctx.createGain();
    delayInput.connect(delayNode); delayNode.connect(delayWet).connect(delayOut); delayNode.connect(delayFeedback).connect(delayNode); delayDry.connect(delayOut);
    reverbInput=ctx.createGain(); convolver=ctx.createConvolver(); reverbDry=ctx.createGain(); reverbWet=ctx.createGain(); reverbOut=ctx.createGain();
    reverbInput.connect(convolver).connect(reverbWet).connect(reverbOut); reverbDry.connect(reverbOut);

    eqLow=ctx.createBiquadFilter();eqLow.type="lowshelf";eqLow.frequency.value=90;
    eqLowMid=ctx.createBiquadFilter();eqLowMid.type="peaking";eqLowMid.frequency.value=360;eqLowMid.Q.value=.8;
    eqHighMid=ctx.createBiquadFilter();eqHighMid.type="peaking";eqHighMid.frequency.value=2600;eqHighMid.Q.value=.8;
    eqHigh=ctx.createBiquadFilter();eqHigh.type="highshelf";eqHigh.frequency.value=9000;
    compressor=ctx.createDynamicsCompressor();compressorMakeup=ctx.createGain();limiter=ctx.createDynamicsCompressor();masterGain=ctx.createGain(); analyser=ctx.createAnalyser();
    analyser.fftSize=256; analyser.smoothingTimeConstant=.65;

    masterInput.connect(masterHeadroom).connect(masterFilter).connect(driveNode).connect(masterGate);
    masterGate.connect(delayDry);masterGate.connect(delayInput);
    delayOut.connect(reverbDry);delayOut.connect(reverbInput);
    reverbOut.connect(eqLow).connect(eqLowMid).connect(eqHighMid).connect(eqHigh).connect(compressor).connect(compressorMakeup).connect(masterGain).connect(limiter).connect(analyser).connect(ctx.destination);
    updateAudioFx(true);
  }
  function armTransportProgram(programIndex){
    if(!Number.isInteger(programIndex)||programIndex<0||programIndex>=PROGRAM_COUNT)return false;
    if(transportPrograms.has(programIndex))return false;
    transportProgramGeneration[programIndex]++;transportPrograms.add(programIndex);return true;
  }
  function disarmTransportProgram(programIndex){
    if(!Number.isInteger(programIndex)||programIndex<0||programIndex>=PROGRAM_COUNT)return false;
    transportProgramGeneration[programIndex]++;return transportPrograms.delete(programIndex);
  }
  function clearTransportPrograms(){
    for(const programIndex of transportPrograms)transportProgramGeneration[programIndex]++;
    transportPrograms.clear();
  }
  function anyProgramSolo(){return state.programs.some(p=>p?.soloed);}
  function programAudibleTarget(programIndex){const p=state.programs[programIndex];if(!p)return 0;return (!p.muted&&(!anyProgramSolo()||p.soloed))?1:0;}
  function syncProgramStripUi(){
    const anySolo=anyProgramSolo();
    for(let i=0;i<PROGRAM_COUNT;i++){
      const p=state.programs[i],slot=document.querySelector(`[data-program-slot="${i}"]`);
      if(!p||!slot)continue;
      slot.classList.toggle("muted",!!p.muted);slot.classList.toggle("soloed",!!p.soloed);slot.classList.toggle("solo-muted",anySolo&&!p.soloed);slot.classList.toggle("sequencing",state.transport&&transportPrograms.has(i));
      slot.querySelector(`[data-program-mute="${i}"]`)?.classList.toggle("on",!!p.muted);
      slot.querySelector(`[data-program-solo="${i}"]`)?.classList.toggle("on",!!p.soloed);
    }
  }
  function refreshProgramAudibility(immediate=false){for(let i=0;i<PROGRAM_COUNT;i++)if(programBuses.has(i))applyProgramMute(i,immediate);syncProgramStripUi();}
  function ensureProgramBus(programIndex){
    if(programBuses.has(programIndex))return programBuses.get(programIndex);
    const ctx=getContext(),input=ctx.createGain(),programGain=ctx.createGain(),muteGain=ctx.createGain(),meter=ctx.createAnalyser();
    meter.fftSize=128;meter.smoothingTimeConstant=.58;
    programGain.gain.value=dbToGain(state.programs[programIndex]?.volumeDb||0);muteGain.gain.value=programAudibleTarget(programIndex);
    // Meter fica pós-fader e pré-mute: o volume altera a leitura e MUTE mantém atividade em cinza.
    input.connect(programGain).connect(meter).connect(muteGain).connect(masterInput);
    programBuses.set(programIndex,input);programMeters.set(programIndex,{analyser:meter,data:new Float32Array(meter.fftSize),programGain,muteGain,level:0});return input;
  }
  function applyProgramMute(programIndex,immediate=false){
    if(!audioCtx)return;ensureProgramBus(programIndex);const entry=programMeters.get(programIndex),gain=entry?.muteGain,now=getContext().currentTime,target=programAudibleTarget(programIndex);
    if(!gain)return;try{gain.gain.cancelScheduledValues(now);if(immediate)gain.gain.setValueAtTime(target,now);else gain.gain.setTargetAtTime(target,now,.008);}catch{gain.gain.value=target;}
  }
  function applyProgramVolume(programIndex,immediate=false){
    if(!audioCtx)return;ensureProgramBus(programIndex);const entry=programMeters.get(programIndex),gain=entry?.programGain,now=getContext().currentTime,target=dbToGain(state.programs[programIndex]?.volumeDb||0);
    if(!gain)return;try{gain.gain.cancelScheduledValues(now);if(immediate)gain.gain.setValueAtTime(target,now);else gain.gain.setTargetAtTime(target,now,.008);}catch{gain.gain.value=target;}
  }
  function setProgramVolume(programIndex,value){const program=state.programs[programIndex];if(!program)return;program.volumeDb=clamp(Number(value)||0,-48,6);applyProgramVolume(programIndex);queueAutosave();const label=document.querySelector(`[data-program-db="${programIndex}"]`);if(label)label.textContent=program.volumeDb<=-47.9?"-∞":`${program.volumeDb>0?"+":""}${program.volumeDb.toFixed(0)}`;}
  function toggleProgramMute(programIndex){
    const program=state.programs[programIndex];if(!program)return;pushHistory();program.muted=!program.muted;applyProgramMute(programIndex);queueAutosave();syncProgramStripUi();notice(`PROGRAM ${String(programIndex+1).padStart(2,"0")} ${program.muted?"MUTED":"UNMUTED"}.`,program.muted?"warn":"ok",true);
  }
  function toggleProgramSolo(programIndex){
    const program=state.programs[programIndex];if(!program)return;pushHistory();program.soloed=!program.soloed;refreshProgramAudibility();queueAutosave();notice(`PROGRAM ${String(programIndex+1).padStart(2,"0")} SOLO ${program.soloed?"ON":"OFF"}.`,program.soloed?"ok":"",true);
  }
  function stopProgram(programIndex){
    if(!state.programs[programIndex])return;disarmTransportProgram(programIndex);clearLoopIntentProgram(programIndex);syncProgramStripUi();const target=getContext().currentTime+.004;
    for(let i=0;i<PAD_COUNT;i++){const set=voiceSet(programIndex,i);if(set)for(const v of [...set])releaseVoice(programIndex,i,v,target,STOP_FADE);}
    for(const [key,voice] of [...patternPreviewVoices])if(voice?.programIndex===programIndex){releaseVoice(programIndex,voice.padIndex,voice,target,STOP_FADE);patternPreviewVoices.delete(key);}
    notice(`PROGRAM ${String(programIndex+1).padStart(2,"0")} parado.`,"ok",true);
  }
  function beatSeconds() { return 60 / state.tempo; }
  function globalClockReference(){const ctx=getContext();return state.transport?transportOrigin:(masterClockOrigin||ctx.currentTime);}
  function divisionSeconds(division) { const q=QUANTIZE[division]||4; return beatSeconds()/q; }
  function setMasterPerfParam(id,value){try{masterPerfNode?.port?.postMessage({type:"param",id,value});}catch{}}
  function connectAdvancedFxChain(){
    if(!workletsReady||!masterPerfNode)return;
    try{driveNode.disconnect();}catch{}
    driveNode.connect(masterPerfNode).connect(masterGate);
  }
  async function ensureWorkletFx(){
    if(workletsReady)return true;if(workletsPromise)return workletsPromise;
    workletsPromise=(async()=>{try{
      const ctx=getContext();if(!ctx.audioWorklet||typeof AudioWorkletNode==="undefined")throw new Error("AudioWorklet indisponível");
      await ctx.audioWorklet.addModule(`js/pad-performance-processor.js?v=260`);
      masterPerfNode=new AudioWorkletNode(ctx,"ns-pad-performance",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit"});
      workletsReady=true;connectAdvancedFxChain();syncMasterPerformanceActivity(true);updateAudioFx(true);return true;
    }catch(err){console.warn("NT Sampler performance FX unavailable",err);workletsReady=false;return false;}})();return workletsPromise;
  }
  function syncAdvancedTransport(){if(!audioCtx||!workletsReady)return;const originFrame=Math.round(globalClockReference()*audioCtx.sampleRate);setMasterPerfParam("bpm",state.tempo);setMasterPerfParam("transportOriginFrame",originFrame);}
  function syncAdvancedFxParams(){
    if(!workletsReady||!masterPerfNode)return;const f=state.fx;
    for(const name of ["scatter","glitch","patternSlicer","stepSlicer","oscBot"]){const obj=f[name]||defaultFx()[name];for(const [k,v] of Object.entries(obj))setMasterPerfParam(`${name}.${k}`,v);}
    syncAdvancedTransport();syncMasterPerformanceActivity();
  }
  function constantPowerMix(mix){mix=clamp(Number(mix)||0,0,1);return {dry:Math.cos(mix*Math.PI*.5),wet:Math.sin(mix*Math.PI*.5)};}
  function scheduleMasterImpulse(size){
    clearTimeout(masterImpulseTimer);masterImpulseTimer=setTimeout(()=>{if(!audioCtx||!convolver)return;const ctx=getContext(),now=ctx.currentTime,target=state.fx.reverb.on?constantPowerMix(state.fx.reverb.mix).wet*.72:0;try{reverbWet.gain.cancelScheduledValues(now);reverbWet.gain.setTargetAtTime(.0001,now,.012);}catch{}setTimeout(()=>{if(!convolver)return;convolver.buffer=makeImpulse(size);const t=getContext().currentTime;reverbWet.gain.setTargetAtTime(target,t,.025);},32);},100);
  }
  function updateAudioFx(force=false) {
    if (!audioCtx || !masterFilter) return;
    const now=audioCtx.currentTime,f=state.fx;
    masterFilter.frequency.setTargetAtTime(f.filter.on?clamp(f.filter.cutoff,80,20000):20000,now,.018);
    driveNode.curve=makeDriveCurve(f.drive.on?f.drive.amount:0);
    masterGain.gain.setTargetAtTime(dbToGain(f.masterDb),now,.018);

    const dMix=f.delay.on?constantPowerMix(f.delay.mix):{dry:1,wet:0};
    delayDry.gain.setTargetAtTime(dMix.dry,now,.018);delayWet.gain.setTargetAtTime(dMix.wet*.85,now,.018);
    delayFeedback.gain.setTargetAtTime(f.delay.on?clamp(f.delay.feedback,0,.78):0,now,.022);
    delayNode.delayTime.setTargetAtTime(divisionSeconds(f.delay.division),now,.018);
    const rMix=f.reverb.on?constantPowerMix(f.reverb.mix):{dry:1,wet:0};
    reverbDry.gain.setTargetAtTime(rMix.dry,now,.018);reverbWet.gain.setTargetAtTime(rMix.wet*.72,now,.018);
    if(force||!convolver.buffer)scheduleMasterImpulse(f.reverb.size);

    const eq=f.eq||defaultFx().eq;for(const [node,key] of [[eqLow,"low"],[eqLowMid,"lowMid"],[eqHighMid,"highMid"],[eqHigh,"high"]])node.gain.setTargetAtTime(eq.on?clamp(eq[key],-12,12):0,now,.018);
    const c=f.compressor||defaultFx().compressor;compressor.threshold.setTargetAtTime(c.on?clamp(c.threshold,-60,0):0,now,.018);compressor.knee.setTargetAtTime(c.on?9:0,now,.018);compressor.ratio.setTargetAtTime(c.on?clamp(c.ratio,1,20):1,now,.018);compressor.attack.setTargetAtTime(c.on?clamp(c.attack,.001,.2):.01,now,.018);compressor.release.setTargetAtTime(c.on?clamp(c.release,.03,1):.18,now,.018);compressorMakeup.gain.setTargetAtTime(c.on?dbToGain(clamp(c.makeup,-6,9)):1,now,.018);
    const l=f.limiter||defaultFx().limiter;limiter.threshold.setTargetAtTime(l.on?clamp(l.ceiling,-12,0):0,now,.012);limiter.knee.setTargetAtTime(0,now,.012);limiter.ratio.setTargetAtTime(l.on?20:1,now,.012);limiter.attack.setTargetAtTime(l.on?.001:.01,now,.012);limiter.release.setTargetAtTime(l.on?clamp(l.release,.03,.5):.08,now,.012);
    syncAdvancedFxParams();
    // Master control moves must never rebuild/resync every pad rack. That work caused
    // unnecessary main-thread/message traffic while dragging MIX/threshold controls.
    updateMasterCompactUi();
  }


  async function getLocalBlob(id) {
    if (localBlobCache.has(id)) return localBlobCache.get(id);
    const record=await idbGet("assets",id);
    if (!record?.blob) throw new Error("sample local não encontrado");
    localBlobCache.set(id,record.blob); return record.blob;
  }
  async function loadBuffer(source) {
    if (!source) throw new Error("sem source");
    const key=sourceKey(source);
    if (bufferCache.has(key)) { const cached=bufferCache.get(key); if(Array.isArray(source.waveform)&&source.waveform.length)waveformCache.set(key,source.waveform); else if(!waveformCache.has(key))scheduleWaveform(source,cached); return cached; }
    const ctx=getContext(); let arrayBuffer;
    if (source.kind === "local") arrayBuffer=await (await getLocalBlob(source.id)).arrayBuffer();
    else { const response=await fetch(source.url); if(!response.ok) throw new Error(source.name); arrayBuffer=await response.arrayBuffer(); }
    const buffer=await ctx.decodeAudioData(arrayBuffer.slice(0));
    bufferCache.set(key,buffer);
    if(Array.isArray(source.waveform)&&source.waveform.length)waveformCache.set(key,source.waveform);
    else scheduleWaveform(source,buffer);
    return buffer;
  }
  async function playbackBuffer(source, reverse=false) {
    const base=await loadBuffer(source); if(!reverse) return base;
    const key=`${sourceKey(source)}:reverse`; if(reverseCache.has(key)) return reverseCache.get(key);
    const ctx=getContext(), out=ctx.createBuffer(base.numberOfChannels,base.length,base.sampleRate);
    for(let c=0;c<base.numberOfChannels;c++){const src=base.getChannelData(c), dst=out.getChannelData(c);for(let i=0,j=src.length-1;i<src.length;i++,j--)dst[i]=src[j];}
    reverseCache.set(key,out); return out;
  }
  function copyBufferSegment(base,start,end,reverse=false){
    const ctx=getContext(),sr=base.sampleRate,a=clamp(Math.floor(start*sr),0,base.length-1),b=clamp(Math.ceil(end*sr),a+1,base.length),len=b-a,out=ctx.createBuffer(base.numberOfChannels,len,sr);
    for(let c=0;c<base.numberOfChannels;c++){const src=base.getChannelData(c),dst=out.getChannelData(c);if(reverse){for(let i=0;i<len;i++)dst[i]=src[b-1-i]||0;}else dst.set(src.subarray(a,b));}
    return out;
  }
  function linearResampleChannel(src,ratio){
    if(Math.abs(ratio-1)<1e-5)return new Float32Array(src);const outLen=Math.max(2,Math.round(src.length/ratio)),out=new Float32Array(outLen);
    for(let i=0;i<outLen;i++){const x=i*ratio,j=Math.floor(x),f=x-j,a=src[Math.min(j,src.length-1)]||0,b=src[Math.min(j+1,src.length-1)]||a;out[i]=a+(b-a)*f;}return out;
  }
  function olaStretchChannel(src,targetLen){
    targetLen=Math.max(2,Math.round(targetLen));if(Math.abs(targetLen-src.length)<4)return new Float32Array(src);
    const grain=Math.min(2048,Math.max(256,2**Math.floor(Math.log2(Math.max(256,Math.min(2048,src.length/4))))));
    const hopA=Math.max(64,grain>>2),frames=Math.max(2,Math.floor((src.length-grain)/hopA)+1),hopS=Math.max(1,(targetLen-grain)/Math.max(1,frames-1));
    const out=new Float32Array(targetLen),norm=new Float32Array(targetLen);
    for(let f=0;f<frames;f++){const ia=Math.min(src.length-grain,Math.round(f*hopA)),oa=Math.round(f*hopS);for(let i=0;i<grain&&oa+i<targetLen;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(grain-1));out[oa+i]+=(src[ia+i]||0)*w;norm[oa+i]+=w;}}
    for(let i=0;i<targetLen;i++)if(norm[i]>.0001)out[i]/=norm[i];return out;
  }
  function padTransformDescriptor(pad,base){
    const start=clamp(Number(pad.start)||0,0,Math.max(0,base.duration-.001)),end=clamp(Number(pad.end)||base.duration,start+.001,base.duration);
    const timeFactor=clamp((pad.tempoSync&&pad.originalBpm?pad.originalBpm/state.tempo:1)*(pad.stretch||1),.25,4),pitchRatio=Math.pow(2,(pad.pitch||0)/12);
    const key=`${sourceKey(pad.source)}|${start.toFixed(5)}|${end.toFixed(5)}|${pad.reverse?1:0}|p${pad.pitch}|t${timeFactor.toFixed(5)}`;
    return {start,end,timeFactor,pitchRatio,key};
  }
  function readyTransformedPadBuffer(pad){
    if(!pad?.source)return null;const base=bufferCache.get(sourceKey(pad.source));if(!base)return null;
    const {key}=padTransformDescriptor(pad,base);return transformedBufferCache.get(key)||null;
  }
  async function transformedPadBuffer(pad){
    const base=await loadBuffer(pad.source),desc=padTransformDescriptor(pad,base),{start,end,timeFactor,pitchRatio,key}=desc;
    if(transformedBufferCache.has(key))return transformedBufferCache.get(key);
    const segment=copyBufferSegment(base,start,end,pad.reverse),targetLen=Math.max(2,Math.round(segment.length*timeFactor)),ctx=getContext(),out=ctx.createBuffer(segment.numberOfChannels,targetLen,segment.sampleRate);
    for(let c=0;c<segment.numberOfChannels;c++){const pitched=linearResampleChannel(segment.getChannelData(c),pitchRatio),stretched=olaStretchChannel(pitched,targetLen);out.getChannelData(c).set(stretched.subarray(0,targetLen));}
    transformedBufferCache.set(key,out);if(transformedBufferCache.size>64)transformedBufferCache.delete(transformedBufferCache.keys().next().value);return out;
  }
  function detectSampleBpm(buffer){
    const data=buffer.getChannelData(0),sr=buffer.sampleRate,hop=Math.max(64,Math.round(sr/200)),envLen=Math.floor(data.length/hop);if(envLen<80)return {bpm:null,confidence:0};
    const env=new Float32Array(envLen);let prev=0;for(let i=0;i<envLen;i++){let sum=0;const off=i*hop;for(let j=0;j<hop&&off+j<data.length;j++){const v=data[off+j];sum+=v*v;}const rms=Math.sqrt(sum/hop),flux=Math.max(0,rms-prev);env[i]=flux;prev=rms*.75+prev*.25;}
    let mean=0;for(const v of env)mean+=v;mean/=env.length;for(let i=0;i<env.length;i++)env[i]=Math.max(0,env[i]-mean*.5);
    const rate=sr/hop;let best=0,bestBpm=0,total=0;for(let bpm=60;bpm<=180;bpm++){const lag=Math.round(rate*60/bpm);let score=0,n=0;for(let i=lag;i<env.length;i++){score+=env[i]*env[i-lag];n++;}score/=Math.max(1,n);total+=score;if(score>best){best=score;bestBpm=bpm;}}
    let confidence=total>0?clamp(best/(total/121)/8,0,1):0;
    const dur=buffer.duration;for(const beats of [1,2,4,8,16,32]){let bpm=60*beats/dur;while(bpm<60)bpm*=2;while(bpm>180)bpm/=2;if(Math.abs(bpm-bestBpm)<4){bestBpm=Math.round((bestBpm+bpm)/2);confidence=Math.max(confidence,.68);break;}}
    return confidence>.28?{bpm:clamp(Math.round(bestBpm),30,300),confidence}:{bpm:null,confidence};
  }

  function makePeaks(buffer,count=64) {
    const data=buffer.getChannelData(0),block=Math.max(1,Math.floor(data.length/count)),out=new Array(count);
    for(let i=0;i<count;i++){
      const start=i*block,end=Math.min(data.length,start+block),stride=Math.max(1,Math.ceil((end-start)/96));
      let peak=.018,sum=0,n=0;
      for(let j=start;j<end;j+=stride){const a=Math.abs(data[j]||0);if(a>peak)peak=a;sum+=a*a;n++;}
      const rms=Math.sqrt(sum/Math.max(1,n));out[i]=clamp(peak*.68+rms*.52,.018,1);
    }
    const smooth=out.map((v,i)=>clamp(v*.62+(out[i-1]??v)*.19+(out[i+1]??v)*.19,.018,1));
    return smooth;
  }
  function storeWaveformForSource(key,peaks){
    for(const src of [...state.localFiles,...state.serverFiles])if(sourceKey(src)===key)src.waveform=peaks;
    for(const program of state.programs)for(const pad of program.pads)if(sourceKey(pad.source)===key)pad.source.waveform=peaks;
  }
  function updateVisibleWaveform(key){
    const program=currentProgram();
    program.pads.forEach((pad,i)=>{if(sourceKey(pad.source)!==key)return;const holder=document.querySelector(`[data-pad="${i}"] .pad-wave`);if(holder)holder.outerHTML=waveHtml(pad.source);});
  }
  function scheduleWaveform(source,buffer){
    const key=sourceKey(source);if(!key||waveformCache.has(key)||waveformPending.has(key))return;waveformPending.add(key);
    const run=()=>{try{const peaks=makePeaks(buffer,64);waveformCache.set(key,peaks);storeWaveformForSource(key,peaks);updateVisibleWaveform(key);queueAutosave();}catch(err){console.warn("waveform",err);}finally{waveformPending.delete(key);}};
    if(!state.transport)setTimeout(run,0);else if(typeof requestIdleCallback==="function")requestIdleCallback(run,{timeout:120});else setTimeout(run,16);
  }

  const voiceKey = (programIndex,padIndex) => `${programIndex}:${padIndex}`;
  const voiceSet = (programIndex,padIndex) => padVoices.get(voiceKey(programIndex,padIndex));
  function addVoice(programIndex,padIndex,voice) {
    const key=voiceKey(programIndex,padIndex); if(!padVoices.has(key))padVoices.set(key,new Set()); padVoices.get(key).add(voice);
    setPadActive(programIndex,padIndex,true);syncMasterPerformanceActivity();
  }
  function removeVoice(programIndex,padIndex,voice) {
    const key=voiceKey(programIndex,padIndex),set=padVoices.get(key); if(!set)return; set.delete(voice);
    if(!set.size){padVoices.delete(key);setPadActive(programIndex,padIndex,false);}
    syncMasterPerformanceActivity();
  }
  function setPadActive(programIndex,padIndex,on){if(programIndex===state.currentProgram)document.querySelector(`[data-pad="${padIndex}"]`)?.classList.toggle("active",on);}
  function holdParam(param,time){
    try{if(typeof param.cancelAndHoldAtTime==="function")param.cancelAndHoldAtTime(time);else{param.cancelScheduledValues(time);param.setValueAtTime(Math.max(.0001,param.value),time);}}catch{}
  }
  function clearVoiceBoundaryStop(voice,restoreGate=true){if(!voice)return;if(voice.boundaryTimer){clearTimeout(voice.boundaryTimer);voice.boundaryTimer=null;}if(voice.modeGate){const now=getContext().currentTime;try{voice.modeGate.gain.cancelScheduledValues(now);if(restoreGate)voice.modeGate.gain.setTargetAtTime(1,now,.002);}catch{}}}
  function voiceRawPosition(voice,now=getContext().currentTime){const anchor=Math.max(voice.rateChangedAt,voice.scheduled);return Math.max(0,voice.phaseSource+(Math.max(0,now-anchor)*voice.rate));}
  function voiceSegmentPosition(voice,now=getContext().currentTime){return voice.segmentDuration?voiceRawPosition(voice,now)%voice.segmentDuration:0;}
  function updateVoiceRateTracking(voice,newRate,now=getContext().currentTime){voice.phaseSource=now<voice.scheduled?0:voiceRawPosition(voice,now);voice.rateChangedAt=Math.max(now,voice.scheduled);voice.rate=newRate;}
  function releaseVoice(programIndex,padIndex,voice,when=null,releaseOverride=null,endAtWhen=false) {
    if(!voice || voice.ended)return;
    voice.ended=true; clearVoiceBoundaryStop(voice,false);
    const ctx=getContext(), target=Math.max(ctx.currentTime+.002,when??ctx.currentTime+.002);
    const rel=clamp(releaseOverride??Math.max(STOP_FADE,voice.release??STOP_FADE),.012,2);
    const start=endAtWhen?Math.max(ctx.currentTime+.001,target-rel):target, end=endAtWhen?target:target+rel;
    // STOP nunca corta o BufferSource diretamente. Um gate dedicado faz a rampa local
    // antes do rack do pad, então delay/reverb continuam vivos e não há descontinuidade DC.
    const gate=voice.stopGate||voice.amp;
    try{
      holdParam(gate.gain,start);
      const current=Math.max(.0001,Math.min(1.5,Number(gate.gain.value)||1));
      const points=48,curve=new Float32Array(points);
      for(let i=0;i<points;i++){const x=i/(points-1);curve[i]=Math.max(.00001,current*Math.cos(x*Math.PI*.5));}
      gate.gain.setValueCurveAtTime(curve,start,Math.max(.012,end-start));
      voice.source.stop(Math.max(end+.010,ctx.currentTime+.014));
    }catch{}
  }
  function scheduleVoiceBoundaryStop(programIndex,padIndex,voice,force=false){
    if(!voice||voice.ended)return; clearVoiceBoundaryStop(voice);
    const pad=state.programs[programIndex]?.pads[padIndex]; if(!pad)return;
    if(!force && pad.mode!=="oneshot")return;
    const ctx=getContext(),now=ctx.currentTime,beforeStart=now<voice.scheduled,pos=beforeStart?0:voiceSegmentPosition(voice,now),remaining=Math.max(.001,voice.segmentDuration-pos),boundary=(beforeStart?voice.scheduled:now)+remaining/Math.max(.01,voice.rate),fade=.012;
    const fadeStart=Math.max(now,boundary-fade);
    try{voice.modeGate.gain.cancelScheduledValues(now);voice.modeGate.gain.setValueAtTime(1,fadeStart);voice.modeGate.gain.linearRampToValueAtTime(0,boundary);}catch{}
    const stopDelay=Math.max(0,(boundary-ctx.currentTime+.012)*1000);
    voice.boundaryTimer=setTimeout(()=>{
      voice.boundaryTimer=null;if(voice.ended)return;const livePad=state.programs[programIndex]?.pads[padIndex];
      if(force||livePad?.mode==="oneshot"){voice.ended=true;try{voice.source.stop(Math.max(ctx.currentTime+.002,boundary+.002));}catch{}}else clearVoiceBoundaryStop(voice,true);
    },stopDelay);
  }
  function gateKey(programIndex,padIndex){return voiceKey(programIndex,padIndex);}
  function beginGatePress(programIndex,padIndex){
    const key=gateKey(programIndex,padIndex),prev=gatePressState.get(key),generation=(prev?.generation||0)+1;
    const info={generation,down:true,releasedAt:null};gatePressState.set(key,info);return generation;
  }
  function endGatePress(programIndex,padIndex){
    const key=gateKey(programIndex,padIndex),info=gatePressState.get(key);
    if(info){info.down=false;info.releasedAt=getContext().currentTime;gatePressState.set(key,info);}
    stopPad(padIndex,null,programIndex);
  }
  function gatePressInfo(programIndex,padIndex,token){
    const info=gatePressState.get(gateKey(programIndex,padIndex));
    return info&&info.generation===token?info:null;
  }
  function loopKey(programIndex,padIndex){return voiceKey(programIndex,padIndex);}
  function setLoopDesired(programIndex,padIndex,on){const key=loopKey(programIndex,padIndex),gen=(loopToggleGeneration.get(key)||0)+1;loopToggleGeneration.set(key,gen);loopToggleDesired.set(key,!!on);return gen;}
  function loopDesired(programIndex,padIndex){const key=loopKey(programIndex,padIndex);if(loopToggleDesired.has(key))return !!loopToggleDesired.get(key);const set=voiceSet(programIndex,padIndex);return !!set&&[...set].some(v=>v&&!v.ended);}
  function clearLoopIntentProgram(programIndex){for(let i=0;i<PAD_COUNT;i++)setLoopDesired(programIndex,i,false);}
  function stopPad(index,when=null,programIndex=state.currentProgram){const pad=state.programs[programIndex]?.pads[index];if(pad?.mode==="loop")setLoopDesired(programIndex,index,false);const set=voiceSet(programIndex,index);if(!set)return;const target=Math.max(getContext().currentTime+.002,when??0);[...set].forEach(v=>releaseVoice(programIndex,index,v,target));}
  function stopAll(notify=true){
    if(state.transport)stopTransport();state.patternRecord=false;patternPreviewVoices.clear();
    for(let pr=0;pr<PROGRAM_COUNT;pr++)clearLoopIntentProgram(pr);
    const target=getContext().currentTime+.004;
    for(const set of [...padVoices.values()])for(const v of [...set])releaseVoice(v.programIndex,v.padIndex,v,target,STOP_FADE);
    stopPreview();document.querySelectorAll(".record-pattern").forEach(r=>r.classList.remove("on"));
    if(notify)notice("STOP ALL · transporte e pads parados. FX tails preservados.","ok",true);
  }
  function panic(){stopAll(false);masterGate?.gain.cancelScheduledValues(getContext().currentTime);if(masterGate)masterGate.gain.value=1;}

  function nextQuantizedTime(pad) {
    const ctx=getContext(), now=ctx.currentTime, lead=.028;
    if(pad?.triggerMode==="free" || state.quantize==="off") return now+.001;
    const grid=divisionSeconds(state.quantize), origin=globalClockReference(), target=now+lead;
    const n=Math.max(0,Math.ceil((target-origin-.000001)/grid)); return origin+n*grid;
  }
  function applyVoiceParam(voice,key,value){
    if(!voice||voice.ended)return;
    if(key==="release")voice.release=value;
    if(["gainDb","pan","cutoff","resonance"].includes(key))updatePadRack(voice.programIndex,voice.padIndex,false);
    if(key==="pitch"&&state.programs[voice.programIndex]?.pads[voice.padIndex]?.mode==="loop")scheduleLoopRefresh(voice.programIndex,voice.padIndex);
  }
  function applyPadParamToVoices(programIndex,padIndex,key,value){const set=voiceSet(programIndex,padIndex),pad=state.programs[programIndex]?.pads[padIndex];if(["gainDb","pan","cutoff","resonance"].includes(key))updatePadRack(programIndex,padIndex,false);if(!set)return;for(const voice of set){applyVoiceParam(voice,key,value);if(key==="pitch"&&(voice.forceOneShot||pad?.mode==="oneshot"))scheduleVoiceBoundaryStop(programIndex,padIndex,voice,voice.forceOneShot);}}
  function applyPadModeToVoices(programIndex,padIndex,mode){const set=voiceSet(programIndex,padIndex);if(!set)return;for(const voice of set){if(voice.forceOneShot)continue;if(mode==="oneshot")scheduleVoiceBoundaryStop(programIndex,padIndex,voice);else clearVoiceBoundaryStop(voice);}}
  function syncAllActiveVoicesToState(){const touched=new Set();for(const set of padVoices.values())for(const voice of [...set]){const pad=state.programs[voice.programIndex]?.pads[voice.padIndex];if(!pad?.source||sourceKey(pad.source)!==voice.sourceId){releaseVoice(voice.programIndex,voice.padIndex,voice,null,.012);continue;}voice.release=pad.release;touched.add(voiceKey(voice.programIndex,voice.padIndex));if(voice.forceOneShot)scheduleVoiceBoundaryStop(voice.programIndex,voice.padIndex,voice,true);else applyPadModeToVoices(voice.programIndex,voice.padIndex,pad.mode);}for(const key of touched){const [pr,pi]=key.split(":").map(Number);updatePadRack(pr,pi,false);}}

  function scheduleLoopRefresh(programIndex,padIndex){
    const key=voiceKey(programIndex,padIndex),generation=(transformRefreshGeneration.get(key)||0)+1;transformRefreshGeneration.set(key,generation);
    clearTimeout(loopRefreshTimers.get(key));loopRefreshTimers.set(key,setTimeout(async()=>{
      loopRefreshTimers.delete(key);const pad=state.programs[programIndex]?.pads[padIndex];if(!pad?.source)return;
      let nextBuffer;try{nextBuffer=await transformedPadBuffer(pad);}catch{return;}
      if(transformRefreshGeneration.get(key)!==generation)return;
      const set=voiceSet(programIndex,padIndex);if(!set?.size)return;const live=[...set].filter(v=>!v.ended).at(-1);if(!live)return;
      const ctx=getContext(),oldDuration=Math.max(.001,live.segmentDuration),phase=((voiceSegmentPosition(live,ctx.currentTime)/oldDuration)%1+1)%1,newOffset=clamp(phase*nextBuffer.duration,0,Math.max(0,nextBuffer.duration-.001)),when=ctx.currentTime+.010;
      const replacement=await triggerPad(padIndex,{programIndex,when,forceRestart:true,recordHit:false,startOffset:newOffset,transition:true,preparedBuffer:nextBuffer});
      if(!replacement)return;
      for(const v of [...set])if(v!==replacement&&!v.ended)releaseVoice(programIndex,padIndex,v,when,.022,false);
    },36));
  }
  function anyActiveSource(){
    for(const set of padVoices.values())for(const voice of set)if(voice&&!voice.ended)return true;
    return !!previewVoice||!!state.editor?.audition;
  }
  let lastMasterEngineActive=null;
  function syncMasterPerformanceActivity(force=false){
    if(!workletsReady||!masterPerfNode)return;const active=anyActiveSource()?1:0;if(!force&&active===lastMasterEngineActive)return;lastMasterEngineActive=active;setMasterPerfParam("engine.active",active);
  }
  function setWorkletObject(wrapper,obj){Object.entries(obj||{}).forEach(([k,v])=>{if(k!=="on"&&k!=="mix")setWorkletParam(wrapper,k,v)});setWorkletParam(wrapper,"bpm",state.tempo);setWorkletParam(wrapper,"transportOriginFrame",Math.round(globalClockReference()*getContext().sampleRate));}
  function setPadPerfParam(rack,id,value){try{rack?.perfNode?.port?.postMessage({type:"param",id,value});}catch{}}
  function syncPadPerformance(rack,pad){if(!rack?.perfNode||!rack.perfWorklet||!pad)return;setPadPerfParam(rack,"bpm",state.tempo);setPadPerfParam(rack,"transportOriginFrame",Math.round(globalClockReference()*getContext().sampleRate));setPadPerfParam(rack,"engine.active",voiceSet(rack.programIndex,rack.padIndex)?.size?1:0);for(const name of ["scatter","glitch","patternSlicer","stepSlicer","oscBot"]){const obj=pad.fx?.[name]||defaultPadFx()[name];for(const [k,v] of Object.entries(obj))setPadPerfParam(rack,`${name}.${k}`,v);}}
  function refreshRackStutter(rack,pad){if(!rack?.stutterGate)return;const fx=pad.fx?.stutter||defaultPadFx().stutter,ctx=getContext(),g=rack.stutterGate.gain;if(rack.stutterTimer){clearInterval(rack.stutterTimer);rack.stutterTimer=null;}g.cancelScheduledValues(ctx.currentTime);g.setTargetAtTime(1,ctx.currentTime,.003);if(!fx.on||!voiceSet(rack.programIndex,rack.padIndex)?.size)return;rack.stutterScheduledUntil=ctx.currentTime;const tick=()=>{if(!voiceSet(rack.programIndex,rack.padIndex)?.size){clearInterval(rack.stutterTimer);rack.stutterTimer=null;g.setTargetAtTime(1,ctx.currentTime,.004);return;}const now=ctx.currentTime,origin=globalClockReference(),slice=divisionSeconds(fx.division),ahead=.16;let t=Math.max(rack.stutterScheduledUntil,origin+Math.ceil((now-origin)/slice)*slice);for(;t<now+ahead;t+=slice){const low=Math.max(.0001,1-clamp(fx.depth,0,1));g.setValueAtTime(1,Math.max(t,now));g.setValueAtTime(low,t+slice*.48);g.setValueAtTime(1,t+slice*.76);}rack.stutterScheduledUntil=t;};tick();rack.stutterTimer=setInterval(tick,30);}
  function ensurePadRack(programIndex,padIndex){const key=voiceKey(programIndex,padIndex);if(padFxRacks.has(key))return padFxRacks.get(key);const ctx=getContext(),pad=state.programs[programIndex]?.pads[padIndex];if(!pad)return null;const rack={programIndex,padIndex},programBus=ensureProgramBus(programIndex);rack.programBus=programBus;rack.input=ctx.createGain();rack.stutterGate=ctx.createGain();rack.filter=ctx.createBiquadFilter();rack.filter.type="lowpass";rack.drive=ctx.createWaveShaper();rack.drive.oversample="2x";rack.perfWorklet=!!workletsReady;rack.perfNode=rack.perfWorklet?new AudioWorkletNode(ctx,"ns-pad-performance",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit"}):ctx.createGain();rack.panner=ctx.createStereoPanner();rack.padGain=ctx.createGain();rack.input.connect(rack.stutterGate).connect(rack.filter).connect(rack.drive).connect(rack.perfNode).connect(rack.panner).connect(rack.padGain).connect(programBus);rack.delay=ctx.createDelay(2);rack.delayFeedback=ctx.createGain();rack.delayWet=ctx.createGain();rack.padGain.connect(rack.delay);rack.delay.connect(rack.delayWet).connect(programBus);rack.delay.connect(rack.delayFeedback).connect(rack.delay);rack.convolver=ctx.createConvolver();rack.reverbWet=ctx.createGain();rack.padGain.connect(rack.convolver).connect(rack.reverbWet).connect(programBus);padFxRacks.set(key,rack);updatePadRack(programIndex,padIndex,true);return rack;}
  function updatePadRack(programIndex,padIndex,forceImpulse=false){const rack=padFxRacks.get(voiceKey(programIndex,padIndex));if(!rack)return;const pad=state.programs[programIndex]?.pads[padIndex];if(!pad)return;const fx=pad.fx||defaultPadFx(),ctx=getContext(),now=ctx.currentTime;rack.filter.frequency.setTargetAtTime(pad.cutoff,now,.01);rack.filter.Q.setTargetAtTime(pad.resonance,now,.01);rack.drive.curve=makeDriveCurve(fx.drive.on?fx.drive.amount:0);rack.panner.pan.setTargetAtTime(pad.pan,now,.01);rack.padGain.gain.setTargetAtTime(dbToGain(pad.gainDb),now,.01);rack.delay.delayTime.setTargetAtTime(divisionSeconds(fx.delay.division),now,.01);rack.delayFeedback.gain.setTargetAtTime(fx.delay.on?clamp(fx.delay.feedback,0,.82):0,now,.01);rack.delayWet.gain.setTargetAtTime(fx.delay.on?clamp(fx.delay.mix,0,.8):0,now,.01);if(fx.reverb.on&&(forceImpulse||!rack.convolver.buffer))rack.convolver.buffer=makeImpulse(fx.reverb.size);rack.reverbWet.gain.setTargetAtTime(fx.reverb.on?clamp(fx.reverb.mix,0,.8):0,now,.01);syncPadPerformance(rack,pad);refreshRackStutter(rack,pad);}
  function updatePadFxVoices(programIndex,padIndex,forceImpulse=false){ensurePadRack(programIndex,padIndex);updatePadRack(programIndex,padIndex,forceImpulse);}
  function refreshPadRackActivity(programIndex,padIndex){const rack=padFxRacks.get(voiceKey(programIndex,padIndex)),pad=state.programs[programIndex]?.pads[padIndex];if(!rack||!pad)return;const set=voiceSet(programIndex,padIndex),active=!!set&&[...set].some(v=>v&&!v.ended);setPadPerfParam(rack,"engine.active",active?1:0);refreshRackStutter(rack,pad);}
  function cleanupIdlePadRacks(){for(const [key,rack] of [...padFxRacks]){if(rack.programIndex===state.currentProgram||voiceSet(rack.programIndex,rack.padIndex)?.size)continue;if(rack.stutterTimer)clearInterval(rack.stutterTimer);for(const node of [rack.input,rack.stutterGate,rack.filter,rack.drive,rack.perfNode,rack.panner,rack.padGain,rack.delay,rack.delayFeedback,rack.delayWet,rack.convolver,rack.reverbWet])try{node.disconnect()}catch{};try{rack.perfNode.port.close()}catch{}padFxRacks.delete(key);}}
  function disposeAllPadRacks(){for(const rack of padFxRacks.values()){if(rack.stutterTimer)clearInterval(rack.stutterTimer);for(const node of [rack.input,rack.stutterGate,rack.filter,rack.drive,rack.perfNode,rack.panner,rack.padGain,rack.delay,rack.delayFeedback,rack.delayWet,rack.convolver,rack.reverbWet])try{node.disconnect()}catch{};try{rack.perfNode.port.close()}catch{}}padFxRacks.clear();}


  async function triggerPad(index, options={}) {
    const programIndex=Number.isInteger(options.programIndex)?options.programIndex:state.currentProgram;
    const pad=state.programs[programIndex]?.pads[index]; if(!pad?.source)return null;
    const ctx=getContext(),requestedAt=ctx.currentTime,key=voiceKey(programIndex,index);
    const normalLoopToggle=pad.mode==="loop"&&!options.pattern&&!options.patternPreview&&!options.forceRestart&&!options.transition;
    let loopToken=null;
    if(normalLoopToggle){
      if(loopDesired(programIndex,index)){stopPad(index,null,programIndex);return null;}
      loopToken=setLoopDesired(programIndex,index,true);
    }
    try{
      // The low-latency path is completely synchronous when this pad was warmed.
      // Only fall back to transform/decode work when the cache is genuinely cold.
      const ready=options.preparedBuffer||readyTransformedPadBuffer(pad),buffer=ready||await transformedPadBuffer(pad);
      if(loopToken!==null&&(loopToggleGeneration.get(key)!==loopToken||!loopToggleDesired.get(key)))return null;
      const gateInfo=Number.isInteger(options.gateToken)?gatePressInfo(programIndex,index,options.gateToken):null;
      // Se um novo Note On já substituiu este GATE pendente, descarte a voz antiga.
      if(Number.isInteger(options.gateToken)&&!gateInfo)return null;
      if(options.pattern&&(!state.transport||!transportPrograms.has(programIndex)||Number(options.transportEpoch)!==transportEpoch||Number(options.transportGeneration)!==transportProgramGeneration[programIndex]))return null;
      const rack=ensurePadRack(programIndex,index);if(!rack)throw new Error("Pad FX rack indisponível");
      const now=ctx.currentTime;
      const scheduled=Number.isFinite(options.when)?Math.max(options.when,now+.001):(options.forceFree?now+.001:(pad.triggerMode==="free"||state.quantize==="off"?Math.max(now+.001,requestedAt+.001):nextQuantizedTime(pad))),recordHit=options.recordHit!==false;
      const duration=Math.max(.001,buffer.duration),startOffset=clamp(Number(options.startOffset)||0,0,Math.max(0,duration-.001)),source=ctx.createBufferSource(),amp=ctx.createGain(),modeGate=ctx.createGain(),stopGate=ctx.createGain();
      source.buffer=buffer;source.playbackRate.value=1;source.loop=true;source.loopStart=0;source.loopEnd=duration;
      const attack=options.transition?.012:Math.max(.001,pad.attack);amp.gain.setValueAtTime(.0001,scheduled);amp.gain.exponentialRampToValueAtTime(1,scheduled+attack);modeGate.gain.value=1;stopGate.gain.value=1;
      source.connect(amp).connect(modeGate).connect(stopGate).connect(rack.input);const voice={programIndex,padIndex:index,sourceId:sourceKey(pad.source),source,amp,modeGate,stopGate,rack,release:pad.release,scheduled,start:startOffset,segmentDuration:duration,phaseSource:startOffset,rateChangedAt:scheduled,rate:1,forceOneShot:!!options.pattern||!!options.patternPreview,ended:false,boundaryTimer:null};
      addVoice(programIndex,index,voice);refreshPadRackActivity(programIndex,index);source.onended=()=>{removeVoice(programIndex,index,voice);const previewKey=voiceKey(programIndex,index);if(patternPreviewVoices.get(previewKey)===voice)patternPreviewVoices.delete(previewKey);const live=voiceSet(programIndex,index);if(pad.mode==="loop"&&!voice.forceOneShot&&(!live||![...live].some(v=>!v.ended)))loopToggleDesired.set(key,false);refreshPadRackActivity(programIndex,index);setTimeout(cleanupIdlePadRacks,1200);};source.start(scheduled,startOffset);
      if(voice.forceOneShot||pad.mode==="oneshot")scheduleVoiceBoundaryStop(programIndex,index,voice,voice.forceOneShot);
      else if(pad.mode==="gate"&&gateInfo&&!gateInfo.down){
        // Note Off pode chegar antes do decode/rack terminar. Não o perdemos: toca um
        // pulso mínimo e fecha a voz no clock de áudio, evitando o "terceiro toque sumir".
        const releaseAt=Math.max(ctx.currentTime+.002,scheduled+MIN_GATE_AUDIBLE);
        releaseVoice(programIndex,index,voice,releaseAt,.018,false);
      }
      if(recordHit&&state.patternRecord&&state.transport&&programIndex===state.currentProgram)recordPatternHit(index,scheduled);pulsePadAt(programIndex,index,scheduled);return voice;
    }catch(err){if(loopToken!==null&&loopToggleGeneration.get(key)===loopToken)loopToggleDesired.set(key,false);console.error(err);notice(`Não consegui tocar ${pad.source.name}.`,"warn",true);return null;}
  }
  function pulsePadAt(programIndex,index,when){const delay=Math.max(0,(when-getContext().currentTime)*1000);setTimeout(()=>{if(programIndex!==state.currentProgram)return;const p=document.querySelector(`[data-pad="${index}"]`);p?.classList.add("active");setTimeout(()=>{if(!voiceSet(programIndex,index)?.size)p?.classList.remove("active")},70)},delay);}

  function startTransport({preservePrograms=false}={}) {
    const ctx=getContext(); if(state.transport)return;
    if(!preservePrograms||!transportPrograms.size){clearTransportPrograms();armTransportProgram(state.currentProgram);}
    transportEpoch++;state.transport=true; transportOrigin=ctx.currentTime+.06; nextStepTime=transportOrigin; nextStepIndex=0; scheduledUiSteps=[];
    syncAdvancedTransport();for(const rack of padFxRacks.values())updatePadRack(rack.programIndex,rack.padIndex,false);schedulerTimer=setInterval(scheduler,25);scheduler();updateTransportButtons();syncProgramStripUi();queueAutosave();
  }
  function stopTransport({preservePrograms=false}={}) { if(!state.transport)return;transportEpoch++;state.transport=false;clearInterval(schedulerTimer);schedulerTimer=null;scheduledUiSteps=[];currentUiStep=0;if(!preservePrograms)clearTransportPrograms();if(masterGate){masterGate.gain.cancelScheduledValues(getContext().currentTime);masterGate.gain.setTargetAtTime(1,getContext().currentTime,.005);}syncAdvancedTransport();for(const rack of padFxRacks.values())updatePadRack(rack.programIndex,rack.padIndex,false);updateTransportButtons();updateStepUi(0);syncProgramStripUi(); }
  function toggleTransport(){state.transport?stopTransport():startTransport();}
  function scheduler(){
    if(!state.transport)return;const ctx=getContext(),ahead=.12,stepDur=beatSeconds()/4;
    while(nextStepTime < ctx.currentTime + ahead){
      const globalStep=nextStepIndex;
      for(const programIndex of [...transportPrograms]){
        const program=state.programs[programIndex],pattern=program?.patterns?.[program.activePattern]||program?.pattern,total=pattern?.events?.length||0;if(!total)continue;
        const step=globalStep%total,events=pattern.events[step]||[],transportGeneration=transportProgramGeneration[programIndex];events.forEach(index=>triggerPad(index,{programIndex,when:nextStepTime,recordHit:false,pattern:true,transportEpoch,transportGeneration}));
      }
      if(state.fx.stutter.on)scheduleStutter(nextStepTime,stepDur);
      scheduledUiSteps.push({step:globalStep,time:nextStepTime});nextStepIndex=globalStep+1;nextStepTime+=stepDur;
    }
  }
  function scheduleStutter(stepTime,stepDur){
    const g=masterGate.gain, now=getContext().currentTime, div=state.fx.stutter.division==="1/32"?2:1, slice=stepDur/div, depth=clamp(state.fx.stutter.depth,0,1), low=Math.max(.0001,1-depth);
    for(let i=0;i<div;i++){const t=stepTime+i*slice;g.setValueAtTime(1,Math.max(now,t));g.setValueAtTime(low,t+slice*.48);g.setValueAtTime(1,t+slice*.76);}
  }
  function recordPatternHit(index,when){const p=currentProgram().pattern,total=p.events.length,stepDur=beatSeconds()/4,pos=Math.max(0,when-transportOrigin),step=Math.round(pos/stepDur)%total;if(!p.events[step].includes(index))p.events[step].push(index);queueAutosave();renderPatternOnly();if(state.modal==="pattern")renderPatternGridOnly();}
  function clearPattern(){pushHistory();const program=currentProgram(),old=activePattern(program),fresh=emptyPattern(old.beats,old.name||`PATTERN ${String(program.activePattern+1).padStart(2,"0")}`);program.patterns[program.activePattern]=fresh;program.pattern=fresh;queueAutosave();renderMain();notice("Pattern limpo.","ok",true);}
  function setPatternBeats(beats){const program=currentProgram(),old=activePattern(program);beats=clamp(Math.round(Number(beats)||4),1,64);if(beats===old.beats)return;pushHistory();const newP=emptyPattern(beats,old.name||`PATTERN ${String(program.activePattern+1).padStart(2,"0")}`);for(let i=0;i<Math.min(old.events.length,newP.events.length);i++)newP.events[i]=[...old.events[i]];program.patterns[program.activePattern]=newP;program.pattern=newP;queueAutosave();renderMain();}

  async function togglePreview(source,button){
    const key=sourceKey(source); if(state.previewKey===key && previewVoice){stopPreview();return;}
    const ready=await ensureAudioReady({gesture:true});
    if(!ready){notice("Áudio suspenso. Toque em REARM AUDIO no I/O e tente novamente.","warn",true);return;}
    stopPreview(); state.previewKey=key; button?.closest(".file-item")?.classList.add("previewing");
    try{const buffer=await loadBuffer(source),ctx=getContext(),src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buffer;gain.gain.value=.8;src.connect(gain).connect(masterInput);previewVoice={source:src,gain};previewMeta={key,start:ctx.currentTime,duration:buffer.duration};syncMasterPerformanceActivity();src.onended=stopPreview;src.start(ctx.currentTime+.006);}
    catch(err){console.warn(err);stopPreview();notice("Falha no preview.","warn",true);}
  }
  function stopPreview(immediate=false){
    const voice=previewVoice;previewVoice=null;previewMeta=null;state.previewKey=null;state.previewProgress=0;
    document.querySelectorAll(".file-item.previewing").forEach(e=>e.classList.remove("previewing"));document.querySelectorAll(".preview-line").forEach(e=>e.style.width="0%");
    syncMasterPerformanceActivity();if(!voice)return;try{voice.source.onended=null;const ctx=getContext(),t=ctx.currentTime;if(immediate){voice.source.stop(t+.002);}else{voice.gain.gain.cancelScheduledValues(t);voice.gain.gain.setValueAtTime(Math.max(.0001,voice.gain.gain.value),t);voice.gain.gain.linearRampToValueAtTime(.0001,t+.025);voice.source.stop(t+.03);}}catch{}
  }

  async function assignSourceToPad(index,source) {
    const programIndex=state.currentProgram;
    try{notice("Preparando sample...","");const buffer=await loadBuffer(source);pushHistory();const pad=emptyPad();pad.source={...source};const cachedWave=waveformCache.get(sourceKey(source));if(cachedWave)pad.source.waveform=cachedWave;pad.end=buffer.duration;const detected=detectSampleBpm(buffer);pad.originalBpm=detected.bpm;pad.bpmConfidence=detected.confidence;pad.tempoSync=!!detected.bpm;state.programs[programIndex].pads[index]=pad;setTimeout(()=>{try{ensurePadRack(programIndex,index);}catch{}transformedPadBuffer(pad).catch(()=>{});},0);if(state.currentProgram===programIndex){state.selectedPad=index;state.tab="pad";}queueAutosave();renderMain();notice(`${source.name} carregado no pad ${String(index+1).padStart(2,"0")}.`,"ok",true);}
    catch(err){console.error(err);notice(`Não consegui abrir ${source.name}.`,"warn",true);}
  }
  function clearSelectedPad(){pushHistory();stopPad(state.selectedPad,null,state.currentProgram);currentProgram().pads[state.selectedPad]=emptyPad();queueAutosave();renderMain();}

  async function importLocalFiles(files) {
    if(!files?.length)return;notice(`Importando ${files.length} arquivo(s)...`);let ok=0;
    for(const file of files){if(!isSupportedAudio(file))continue;try{const id=`local-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`,folder=folderOfFile(file);registerFolder(folder);state.assetFolders[id]=folder;const rec={id,name:file.name,size:file.size,type:file.type||"audio/wav",blob:file,folder,createdAt:Date.now()};await idbPut("assets",rec);localBlobCache.set(id,file);const source={kind:"local",id,name:file.name,size:file.size,type:rec.type,folder,createdAt:rec.createdAt};state.localFiles.unshift(source);await loadBuffer(source);ok++;}catch(err){console.error(err);}}
    queueAutosave();renderMain();notice(`${ok} sample(s) local(is) prontos.`,ok?"ok":"warn",true);
  }
  async function deleteLocalAsset(id){const used=state.programs.some(p=>p.pads.some(pad=>pad.source?.kind==="local"&&pad.source.id===id));if(used){notice("Esse sample está em uso por um pad.","warn",true);return;}await idbDelete("assets",id);localBlobCache.delete(id);bufferCache.delete(`local:${id}`);delete state.assetFolders[id];state.localFiles=state.localFiles.filter(f=>f.id!==id);queueAutosave();renderMain();}
  function createVirtualFolder(){const base=state.currentFolder!=="*"&&state.currentFolder?`${state.currentFolder}/`:"",raw=prompt("Nome da nova pasta virtual:",base);if(raw===null)return;const folder=normalizeFolder(raw);if(!folder)return;pushHistory();registerFolder(folder);state.currentFolder=folder;queueAutosave();renderMain();}
  function wavePath(peaks){const n=Math.max(2,peaks.length),top=[],bottom=[];for(let i=0;i<n;i++){const x=i/(n-1)*100,a=clamp(peaks[i]||0,0,1),h=Math.max(2,a*43);top.push(`${x.toFixed(2)} ${(50-h).toFixed(2)}`);bottom.unshift(`${x.toFixed(2)} ${(50+h).toFixed(2)}`);}return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;}
  function waveHtml(source){const peaks=source?.waveform||waveformCache.get(sourceKey(source));if(!peaks?.length)return `<span class="pad-wave pending" aria-hidden="true"><i></i></span>`;return `<span class="pad-wave"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${wavePath(peaks)}"></path><line x1="0" y1="50" x2="100" y2="50"></line></svg></span>`;}
  function padHtml(pad,index){const name=pad.source?.name||"TOQUE PARA SELECIONAR",mode=pad.mode==="oneshot"?"ONE SHOT":pad.mode.toUpperCase(),timing=pad.triggerMode==="free"?"FREE":"Q";return `<button class="pad ${pad.source?"":"empty"} ${state.selectedPad===index?"selected":""} ${voiceSet(state.currentProgram,index)?.size?"active":""}" data-pad="${index}" style="--pad-color:var(--pad-accent)">
    <span class="pad-progress"></span><span class="pad-num">${String(index+1).padStart(2,"0")}</span><span class="pad-mode">${pad.source?`${mode} · ${timing}`:"EMPTY"}</span>${pad.source?waveHtml(pad.source):""}<span class="pad-name">${escapeHtml(name)}</span><span class="pad-meta"><span>${pad.source?`${pad.pitch>=0?"+":""}${pad.pitch.toFixed(0)} ST`:""}</span><span>${pad.source?`${pad.gainDb>=0?"+":""}${pad.gainDb.toFixed(1)} dB`:""}</span></span></button>`;}
  function programHasData(program){return program.pads.some(p=>p.source)||Object.values(program.patterns||{}).some(p=>p?.events?.some(e=>e.length));}

  function renderSplash(){app.innerHTML=`<section class="splash"><div class="splash-card"><img src="assets/noisetupi-logo.png" alt="Noisetupi"><h1>NT SAMPLER 2.8.0</h1><button class="start-btn" data-start>INICIAR SAMPLER</button></div></section>`;document.querySelector("[data-start]").onclick=startApp;}

  const TAB_LABELS={library:"LIBRARY",pad:"PAD",fx:"FX",io:"I/O",project:"PROJECT"};
  function tabsHtml(){return ["library","pad","fx","io","project"].map(t=>`<button class="tab-btn ${state.tab===t?"active":""}" data-tab="${t}">${TAB_LABELS[t]}</button>`).join("");}
  function patternOverviewHtml(pattern){return Array.from({length:pattern.beats},(_,beat)=>{const active=pattern.events.slice(beat*4,beat*4+4).some(e=>e?.length);return `<i class="step beat ${active?"has-event":""}" data-overview-beat="${beat}"></i>`}).join("");}
  function patternBarInnerHtml(program){return `<div class="pattern-launch-summary"><button class="pattern-edit-btn pattern-launch-main" data-open-pattern><b>PTN ${String(program.activePattern+1).padStart(2,"0")}</b><span>${escapeHtml(program.pattern.name||`PATTERN ${String(program.activePattern+1).padStart(2,"0")}`)}</span><small>OPEN PATTERNS</small></button><button class="record-pattern ${state.patternRecord?"on":""}" data-pattern-record>● REC</button><span class="pattern-length">${program.pattern.beats} BEATS</span></div><div class="pattern-steps pattern-overview" data-pattern-steps>${patternOverviewHtml(program.pattern)}</div><span class="message ${state.messageKind}" data-message>${escapeHtml(state.message)}</span><span class="footer-telemetry"><b>AUDIO RT</b><span data-latency>${latencyText()}</span></span>`;}

  function renderMain(){
    applyThemeState();
    if(!state.started)return renderSplash();
    const program=currentProgram();
    app.innerHTML=`<section class="nt-app">
      <header class="topbar">
        <div class="brand"><img src="assets/noisetupi-logo.png" alt="Noisetupi"><strong>SAMPLER 2.8.0</strong></div>
        <div class="transport">
          <button class="icon-btn primary transport-main ${state.transport?"running":""}" data-transport><span class="transport-glyph ${state.transport?"pause":"play"}" aria-hidden="true"></span><small>${state.transport?"PAUSE":"PLAY"}</small></button>
          <button class="icon-btn" data-tap>TAP</button>
          <button class="stop-all-btn" data-stop-all>STOP ALL</button>
          <div class="tempo-box"><span>BPM</span><input data-tempo type="number" min="40" max="240" value="${Math.round(state.tempo)}"></div>
          <select class="quantize-select" data-quantize aria-label="Quantize">${Object.keys(QUANTIZE).map(q=>`<option value="${q}" ${state.quantize===q?"selected":""}>Q ${q.toUpperCase()}</option>`).join("")}</select>
          <button class="history-btn" data-undo title="Undo" ${undoStack.length?"":"disabled"}>↶</button><button class="history-btn" data-redo title="Redo" ${redoStack.length?"":"disabled"}>↷</button>
          <div class="transport-readout"><strong data-position>1.1.01</strong><small>BAR.BEAT.STEP</small></div>
        </div>
        <div class="status-cluster"><div class="master-compact"><span>MASTER</span><input type="range" min="-24" max="6" step=".5" value="${state.fx.masterDb}" data-master-volume><b data-master-volume-value>${state.fx.masterDb>=0?"+":""}${state.fx.masterDb.toFixed(1)} dB</b></div><div class="level-meter"><i data-meter></i></div><button class="panel-toggle ${state.sideHidden?"closed":""}" data-side-toggle>${state.sideHidden?"OPEN PANEL":"HIDE PANEL"}</button></div>
      </header>
      <div class="workspace ${state.sideHidden?"side-hidden":""}" style="--side-w:${clamp(Number(safeStorageGet("nt-sampler-side-width"))||342,260,620)}px">
        <aside class="program-strip"><div class="program-nav"><button class="program-page-btn" data-program-prev data-learn-action="program_prev" title="Previous Program">‹</button><span class="program-label">PROGRAM</span><button class="program-page-btn" data-program-next data-learn-action="program_next" title="Next Program">›</button></div>${state.programs.map((p,i)=>`<div class="program-slot ${p.muted?"muted":""} ${p.soloed?"soloed":""} ${anyProgramSolo()&&!p.soloed?"solo-muted":""} ${state.transport&&transportPrograms.has(i)?"sequencing":""}" data-program-slot="${i}"><button class="program-btn ${i===state.currentProgram?"active":""} ${programHasData(p)?"has-data":""}" data-program="${i}" data-learn-action="program_${i}"><span class="program-number">${String(i+1).padStart(2,"0")}</span><i class="dot"></i></button><span class="program-vu" aria-hidden="true"><i data-program-vu="${i}"></i></span><label class="program-fader" title="Program ${i+1} volume"><input type="range" min="-48" max="6" step="1" value="${p.volumeDb||0}" data-program-volume="${i}"><small data-program-db="${i}">${(p.volumeDb||0)<=-47.9?"-∞":`${(p.volumeDb||0)>0?"+":""}${(p.volumeDb||0).toFixed(0)}`}</small></label><div class="program-actions"><button data-program-stop="${i}" data-learn-action="program_stop_${i}" title="Stop Program ${i+1}"><span class="program-stop-glyph"></span></button><button class="${p.muted?"on":""}" data-program-mute="${i}" data-learn-action="program_mute_${i}" title="Mute Program ${i+1}">M</button><button class="${p.soloed?"on":""}" data-program-solo="${i}" data-learn-action="program_solo_${i}" title="Solo Program ${i+1}">S</button></div></div>`).join("")}</aside>
        <main class="pads-panel"><div class="pads-grid">${program.pads.map(padHtml).join("")}</div></main>
        ${state.sideHidden?"":`<div class="side-resizer" data-side-resizer title="Arraste para redimensionar o painel"></div><aside class="side-panel"><nav class="tabs">${tabsHtml()}</nav><div class="panel-body">${renderPanel()}</div></aside>`}
      </div>
      <footer class="bottombar pattern-bar compact-pattern-bar">${patternBarInnerHtml(program)}</footer>
    </section>${renderLearnToolbar()}${state.editor?renderEditor():""}${state.modal==="pattern"?renderPatternModal():""}${state.modal==="mapping"?renderMappingModal():""}${state.modal==="move"?renderMoveModal():""}${state.modal==="masterExport"?renderMasterExportModal():""}`;
    bindMain(); bindLearnToolbar(); if(state.editor)bindEditor(); if(state.modal==="pattern")bindPatternModal(); if(state.modal==="mapping")bindMappingModal(); if(state.modal==="move")bindMoveModal(); if(state.modal==="masterExport")bindMasterExportModal(); cacheUiRefs(); updateLatencyUi(); updateTransportButtons(); syncProgramStripUi(); syncVisualLearnTargets(); applyThemeState();
  }
  function renderProgramSelection(){
    if(state.editor||state.modal){renderMain();return;}
    applyThemeState();const program=currentProgram();
    document.querySelectorAll("[data-program]").forEach(b=>b.classList.toggle("active",Number(b.dataset.program)===state.currentProgram));
    syncProgramStripUi();
    const grid=document.querySelector(".pads-grid");if(grid){grid.innerHTML=program.pads.map(padHtml).join("");grid.querySelectorAll("[data-pad]").forEach(bindPadButton);}
    if(!state.sideHidden)refreshSidePanel();
    const footer=document.querySelector(".bottombar.pattern-bar");if(footer){footer.innerHTML=patternBarInnerHtml(program);bindPatternBarControls();}
    cacheUiRefs();updateLatencyUi();updateStepUi(currentUiStep);syncVisualLearnTargets();applyThemeState();
  }

  function renderPanel(){if(state.tab==="library")return renderLibrary();if(state.tab==="pad")return renderPadInspector();if(state.tab==="fx")return renderFx();if(state.tab==="io")return renderIo();return renderProject();}
  function libraryFolderFor(f){return normalizeFolder(state.assetFolders?.[f.id]??f.folder??"");}
  function audioLibraryFiles(){return [...state.localFiles,...state.serverFiles].filter(isSupportedAudio);}
  function allLibraryFolders(){const set=new Set();for(const f of audioLibraryFiles()){const folder=libraryFolderFor(f);if(folder){const parts=folder.split("/");for(let i=1;i<=parts.length;i++)set.add(parts.slice(0,i).join("/"));}}return [...set].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));}
  function folderLabel(path){return path?path.split("/").at(-1):"ROOT";}
  function folderFileCount(path){return audioLibraryFiles().filter(f=>{const ff=libraryFolderFor(f);return path==="*"?true:path===""?ff==="":ff===path||ff.startsWith(path+"/");}).length;}
  function folderTreeHtml(){const folders=allLibraryFolders(),collapsed=new Set(state.collapsedFolders||[]);const children=new Map();for(const f of folders){const parts=f.split("/"),parent=parts.slice(0,-1).join("/");if(!children.has(parent))children.set(parent,[]);children.get(parent).push(f);}for(const arr of children.values())arr.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));const branch=(parent="",depth=0)=>{if(parent&&collapsed.has(parent))return "";return (children.get(parent)||[]).map(f=>{const hasKids=(children.get(f)||[]).length>0,isCollapsed=collapsed.has(f);return `<div class="folder-tree-node" style="--depth:${depth}"><button class="folder-toggle ${hasKids?"has-kids":"leaf"}" data-folder-toggle="${escapeHtml(f)}" ${hasKids?"":"disabled"} aria-label="${isCollapsed?"Expand":"Collapse"} ${escapeHtml(folderLabel(f))}"><span>${hasKids?(isCollapsed?"▸":"▾"):"·"}</span></button><button class="folder-tree-row ${state.currentFolder===f?"active":""}" data-folder="${escapeHtml(f)}" title="${escapeHtml(f)}"><span>${escapeHtml(folderLabel(f))}</span><b>${folderFileCount(f)}</b></button></div>${branch(f,depth+1)}`}).join("");};return `<div class="folder-tree"><div class="folder-tree-node root-node"><span class="folder-spacer"></span><button class="folder-tree-row ${state.currentFolder==="*"?"active":""}" data-folder="*"><span>▦ ALL SAMPLES</span><b>${folderFileCount("*")}</b></button></div><div class="folder-tree-node root-node"><span class="folder-spacer"></span><button class="folder-tree-row ${state.currentFolder===""?"active":""}" data-folder=""><span>⌂ ROOT</span><b>${folderFileCount("")}</b></button></div>${branch()}</div>`;}
  function breadcrumbHtml(){if(state.currentFolder==="*")return `<button data-folder="*">ALL SAMPLES</button>`;if(state.currentFolder==="")return `<button data-folder="">ROOT</button>`;const parts=state.currentFolder.split("/");return `<button data-folder="">ROOT</button>${parts.map((part,i)=>`<i>›</i><button data-folder="${escapeHtml(parts.slice(0,i+1).join("/"))}">${escapeHtml(part)}</button>`).join("")}`;}
  function filteredLibrary(){
    const q=state.search.trim().toLowerCase(),folder=state.currentFolder,source=state.librarySource||"all",sort=state.librarySort||"name";
    const list=audioLibraryFiles().filter(f=>{const ff=libraryFolderFor(f),folderOk=folder==="*"?true:ff===folder,sourceOk=source==="all"||f.kind===source,searchOk=!q||f.name.toLowerCase().includes(q)||ff.toLowerCase().includes(q);return folderOk&&sourceOk&&searchOk;});
    list.sort((a,b)=>sort==="size"?(b.size||0)-(a.size||0):sort==="recent"?(b.createdAt||0)-(a.createdAt||0):a.name.localeCompare(b.name,undefined,{numeric:true}));return list;
  }
  async function moveAssetsToFolder(ids,folder){folder=normalizeFolder(folder);if(folder)registerFolder(folder);const sources=[...state.localFiles,...state.serverFiles];pushHistory();for(const id of ids){const src=sources.find(f=>f.id===id);if(!src)continue;state.assetFolders[id]=folder;src.folder=folder;if(src.kind==="local")try{const rec=await idbGet("assets",id);if(rec){rec.folder=folder;await idbPut("assets",rec);}}catch{}}librarySelection.clear();queueAutosave();renderLibraryOnly();notice(`${ids.length} sample(s) movido(s) para ${folder||"ROOT"}.`,"ok",true);}
  async function moveLocalAssetToFolder(id){const src=[...state.localFiles,...state.serverFiles].find(f=>f.id===id);if(!src)return;const list=allLibraryFolders(),raw=prompt(`Mover ${src.name} para qual pasta? Use vazio para ROOT.\\n${list.length?"Pastas: "+list.join(", "):""}`,libraryFolderFor(src));if(raw===null)return;await moveAssetsToFolder([id],raw);}
  function renderLibrary(){
    const files=filteredLibrary(),folders=allLibraryFolders(),selected=[...librarySelection].filter(id=>audioLibraryFiles().some(f=>f.id===id));
    return `<section class="section library-section"><div class="section-head browser-title"><h3>SAMPLE BROWSER</h3><small>${files.length} FILES · ${folders.length} DIRS</small></div>
      <div class="library-actions library-actions-v25"><div class="browser-search"><span>⌕</span><input class="search" data-search value="${escapeHtml(state.search)}" placeholder="SEARCH FILES / FOLDERS"></div><button class="small-btn browser-action" data-import-local>＋ FILES</button><button class="small-btn browser-action" data-import-folder>⇩ FOLDER</button><button class="small-btn browser-action" data-new-folder>＋ DIR</button></div>
      <div class="library-filterbar"><div class="library-source-tabs">${[["all","ALL"],["local","LOCAL"],["server","SERVER"]].map(([v,l])=>`<button class="${(state.librarySource||"all")===v?"active":""}" data-library-source="${v}">${l}</button>`).join("")}</div><select data-library-sort><option value="name" ${state.librarySort==="name"?"selected":""}>A-Z</option><option value="recent" ${state.librarySort==="recent"?"selected":""}>RECENT</option><option value="size" ${state.librarySort==="size"?"selected":""}>SIZE</option></select></div>
      <div class="library-breadcrumb">${breadcrumbHtml()}</div>
      <div class="library-browser" style="--folder-w:${clamp(Number(safeStorageGet("nt-sampler-folder-width"))||168,120,320)}px">${folderTreeHtml()}<div class="folder-resizer" data-folder-resizer title="Arraste para ajustar a largura das pastas"></div><div class="file-pane"><div class="file-toolbar"><span>${selected.length?`■ ${selected.length} SELECTED`:`TARGET · PAD ${String(state.selectedPad+1).padStart(2,"0")}`}</span><button class="toolbar-move" data-move-selected ${selected.length?"":"disabled"}>↪ MOVE</button><button data-clear-selection ${selected.length?"":"disabled"}>CLEAR</button></div><div class="file-list">${files.length?files.map(f=>{const folder=libraryFolderFor(f),sel=librarySelection.has(f.id);return `<div class="file-item ${f.kind==="local"?"local":"server"} ${sel?"selected":""}" data-file-key="${escapeHtml(sourceKey(f))}" data-drag-file="${escapeHtml(f.id)}" draggable="true"><button class="file-select ${sel?"on":""}" data-select-file="${escapeHtml(f.id)}" title="Select">${sel?"✓":""}</button><button class="file-play" data-preview-key="${escapeHtml(sourceKey(f))}" title="Preview">▶</button><span class="file-copy"><strong>${escapeHtml(f.name)}</strong><small><i>${f.kind==="local"?"LOCAL":"SERVER"}</i>${fmtBytes(f.size)?` · ${fmtBytes(f.size)}`:""}${folder?` · ${escapeHtml(folder)}`:""}</small></span><button class="file-drag" data-touch-drag="${escapeHtml(f.id)}" title="Drag to pad">↗</button><button class="file-more" data-move-file="${escapeHtml(f.id)}" title="Move to folder">MOVE</button><button class="file-assign" data-assign-key="${escapeHtml(sourceKey(f))}">LOAD</button><i class="preview-line"></i></div>`}).join(""):`<p class="help file-empty">NO SAMPLES IN THIS VIEW</p>`}</div></div></div>
      <p class="help library-help">Drag samples to pads with ↗ on touch, or use LOAD. Desktop drag/drop is also supported. Select files + MOVE to organize folders.</p></section>`;
  }
  function openMoveDialog(ids){state.moveIds=[...new Set((ids||[]).filter(Boolean))];if(!state.moveIds.length)return;state.modal="move";renderMain();}
  function renderMoveModal(){const folders=allLibraryFolders(),count=state.moveIds?.length||0;return `<div class="editor-backdrop move-backdrop"><section class="move-modal"><header><div><small>LIBRARY ORGANIZER</small><h2>MOVE ${count} SAMPLE${count===1?"":"S"}</h2></div><button class="close-editor" data-close-modal>×</button></header><div class="move-new"><input data-move-new-folder placeholder="NEW FOLDER / SUBFOLDER"><button data-move-create>CREATE + MOVE</button></div><div class="move-destinations"><button data-move-dest=""><span>⌂</span><b>ROOT</b></button>${folders.map(f=>`<button data-move-dest="${escapeHtml(f)}"><span>▸</span><b>${escapeHtml(f)}</b></button>`).join("")}</div></section></div>`;}
  function bindMoveModal(){document.querySelector("[data-close-modal]")?.addEventListener("click",closeModal);document.querySelectorAll("[data-move-dest]").forEach(b=>b.addEventListener("click",async()=>{const ids=[...(state.moveIds||[])];state.modal=null;await moveAssetsToFolder(ids,b.dataset.moveDest);renderMain();}));document.querySelector("[data-move-create]")?.addEventListener("click",async()=>{const input=document.querySelector("[data-move-new-folder]"),folder=normalizeFolder(input?.value);if(!folder)return;registerFolder(folder);const ids=[...(state.moveIds||[])];state.modal=null;await moveAssetsToFolder(ids,folder);renderMain();});}


  function renderPadInspector(){const p=selectedPad();if(!p.source)return `<div class="pad-inspector-empty"><div>PAD ${String(state.selectedPad+1).padStart(2,"0")} VAZIO<br><br>Abra LIBRARY e carregue um sample.</div></div>`;return `<section class="section"><div class="pad-title"><div><small>PAD ${String(state.selectedPad+1).padStart(2,"0")}</small><h2>${escapeHtml(p.source.name)}</h2></div><button class="danger-btn" data-clear-pad>CLEAR</button></div></section>
    <section class="section"><div class="section-head"><h3>TRIGGER / SYNC</h3><small>${fmtShort((p.end||0)-p.start)}</small></div><div class="mode-row">${[["oneshot","ONE SHOT"],["gate","GATE"],["loop","LOOP"]].map(([v,l])=>`<button class="chip ${p.mode===v?"active":""}" data-pad-mode="${v}">${l}</button>`).join("")}</div><div class="mode-row two" style="margin-top:6px">${[["quantize","QUANTIZE"],["free","FREE"]].map(([v,l])=>`<button class="chip ${p.triggerMode===v?"active":""}" data-trigger-mode="${v}">${l}</button>`).join("")}</div><div class="sync-box"><label>ORIGINAL BPM <input data-pad-bpm type="number" min="30" max="300" step=".1" value="${p.originalBpm||""}" placeholder="AUTO"></label><button class="small-btn" data-detect-bpm>DETECT</button><button class="chip ${p.tempoSync?"active":""}" data-tempo-sync>FOLLOW MASTER</button><small>${p.originalBpm?`${p.originalBpm} BPM · ${Math.round(p.bpmConfidence*100)}% detect`:`BPM desconhecido`}</small></div><button class="project-btn primary" style="width:100%;margin-top:7px" data-open-editor>EDIT WAVE / TRIM</button></section>
    <section class="section"><div class="section-head"><h3>PAD PARAMETERS</h3><small>PITCH ≠ TEMPO</small></div><div class="param-grid">${paramRange("GAIN","gainDb",p.gainDb,-36,12,.5,`${p.gainDb>=0?"+":""}${p.gainDb.toFixed(1)} dB`)}${paramRange("PITCH","pitch",p.pitch,-24,24,1,`${p.pitch>=0?"+":""}${p.pitch.toFixed(0)} st`)}${paramRange("STRETCH","stretch",p.stretch,.5,2,.01,`${Math.round(p.stretch*100)}%`)}${paramRange("PAN","pan",p.pan,-1,1,.01,p.pan.toFixed(2))}${paramRange("FILTER","cutoff",p.cutoff,80,20000,10,`${Math.round(p.cutoff)} Hz`)}${paramRange("RESONANCE","resonance",p.resonance,.1,18,.1,p.resonance.toFixed(1))}${paramRange("ATTACK","attack",p.attack,0,.5,.001,`${Math.round(p.attack*1000)} ms`)}${paramRange("RELEASE","release",p.release,.002,2,.002,`${Math.round(p.release*1000)} ms`)}<div class="param wide"><div class="toggle-line"><span>REVERSE</span><button class="switch ${p.reverse?"on":""}" data-reverse><i></i></button></div></div></div></section>`;}
  function padFxButton(key,on,title,sub="PAD FX"){return `<button class="fx-toggle ${on?"on":""}" data-pad-fx-toggle="${key}"><strong>${title}</strong><small>${sub}</small></button>`;}
  function padFxRange(label,path,value,min,max,step,text=formatPadFxValue(path,value)){return `<div class="param"><label><span>${label}</span><strong data-pad-fx-value="${path}">${text}</strong></label><input type="range" data-pad-fx-param="${path}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;}
  function padFxSelect(label,path,value,values){return `<div class="param"><label><span>${label}</span></label><select class="quantize-select" data-pad-fx-select="${path}">${values.map(([v,l])=>`<option value="${v}" ${String(value)===String(v)?"selected":""}>${l}</option>`).join("")}</select></div>`;}
  function paramRange(label,key,value,min,max,step,text){return `<div class="param"><label><span>${label}</span><strong data-param-value="${key}">${text}</strong></label><input type="range" data-pad-param="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;}
  function fxButton(key,on,title,sub){return `<button class="fx-toggle ${on?"on":""}" data-fx-toggle="${key}"><strong>${title}</strong><small>${sub}</small></button>`;}
  function paramFx(label,key,value,min,max,step,text){return `<div class="param"><label><span>${label}</span><strong data-fx-value="${key}">${text}</strong></label><input type="range" data-fx-param="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;}
  function fxSelect(label,path,value,values){return `<div class="param"><label><span>${label}</span></label><select class="quantize-select" data-fx-select="${path}">${values.map(([v,l])=>`<option value="${v}" ${String(value)===String(v)?"selected":""}>${l}</option>`).join("")}</select></div>`;}
  function formatPadFxValue(path,value){if(path.includes("size"))return `${Number(value).toFixed(1)} s`;if(path.includes("note")||path.includes("tone")||path.includes("pattern")||path.includes("rate")||path.includes("steps")||/step\d+$/.test(path))return `${Math.round(Number(value)*100)/100}`;if(path.includes("attack")&&path.startsWith("oscBot"))return `${Math.round(value)}%`;return `${Math.round(Number(value)*100)}%`;}
  function renderPadFxSettings(key,fx){
    if(key==="drive")return `<section class="section fx-settings"><div class="section-head"><h3>DRIVE SETTINGS</h3><small>PAD</small></div><div class="param-grid">${padFxRange("AMOUNT","drive.amount",fx.drive.amount,0,1,.01)}</div></section>`;
    if(key==="delay")return `<section class="section fx-settings"><div class="section-head"><h3>DELAY SETTINGS</h3><small>TEMPO SYNC</small></div><div class="param-grid">${padFxRange("MIX","delay.mix",fx.delay.mix,0,.8,.01)}${padFxRange("FEEDBACK","delay.feedback",fx.delay.feedback,0,.82,.01)}${padFxSelect("DIVISION","delay.division",fx.delay.division,[["1/4","1/4"],["1/8","1/8"],["1/16","1/16"],["1/32","1/32"]])}</div></section>`;
    if(key==="reverb")return `<section class="section fx-settings"><div class="section-head"><h3>REVERB SETTINGS</h3><small>PAD TAIL</small></div><div class="param-grid">${padFxRange("MIX","reverb.mix",fx.reverb.mix,0,.8,.01)}${padFxRange("SIZE","reverb.size",fx.reverb.size,.25,4,.05,`${fx.reverb.size.toFixed(2)} s`)}</div></section>`;
    if(key==="stutter")return `<section class="section fx-settings"><div class="section-head"><h3>STUTTER SETTINGS</h3><small>CLOCK</small></div><div class="param-grid">${padFxRange("DEPTH","stutter.depth",fx.stutter.depth,0,1,.01)}${padFxSelect("DIVISION","stutter.division",fx.stutter.division,[["1/8","1/8"],["1/16","1/16"],["1/32","1/32"]])}</div></section>`;
    if(key==="scatter")return `<section class="section fx-settings"><div class="section-head"><h3>SCATTER SETTINGS</h3><small>LIGHT BUFFER</small></div><div class="param-grid">${padFxRange("MIX","scatter.mix",fx.scatter.mix,0,1,.01)}${padFxRange("RATE","scatter.rate",fx.scatter.rate,1,8,1,`${Math.round(fx.scatter.rate)}×`)}${padFxRange("DEPTH","scatter.depth",fx.scatter.depth,0,1,.01)}${padFxRange("PATTERN","scatter.pattern",fx.scatter.pattern,0,7,1,`${Math.round(fx.scatter.pattern)}`)}</div></section>`;
    if(key==="glitch")return `<section class="section fx-settings"><div class="section-head"><h3>GLITCH SETTINGS</h3><small>BIT / HOLD</small></div><div class="param-grid">${padFxRange("MIX","glitch.mix",fx.glitch.mix,0,1,.01)}${padFxRange("BITS","glitch.bits",fx.glitch.bits,3,16,1,`${Math.round(fx.glitch.bits)} bit`)}${padFxRange("HOLD","glitch.hold",fx.glitch.hold,1,24,1,`${Math.round(fx.glitch.hold)} smp`)}${padFxRange("DROPOUT","glitch.dropout",fx.glitch.dropout,0,.35,.01)}</div></section>`;
    if(key==="oscBot")return `<section class="section fx-settings"><div class="section-head"><h3>OSC BOT SETTINGS</h3><small>PAD WORKLET</small></div><div class="param-grid">${padFxRange("MIX","oscBot.mix",fx.oscBot.mix,0,1,.01)}${padFxRange("DRY INPUT","oscBot.dryInput",fx.oscBot.dryInput,0,1,.01)}${padFxRange("BASE NOTE","oscBot.note",fx.oscBot.note,24,84,1,`${Math.round(fx.oscBot.note)}`)}${padFxRange("TONE","oscBot.tone",fx.oscBot.tone,-50,50,1,`${Math.round(fx.oscBot.tone)}`)}${padFxRange("ATTACK","oscBot.attack",fx.oscBot.attack,0,100,1,`${Math.round(fx.oscBot.attack)}%`)}${padFxRange("SENS","oscBot.sens",fx.oscBot.sens,0,1,.01)}${padFxRange("BALANCE","oscBot.balance",fx.oscBot.balance,0,1,.01)}${padFxRange("SEQ GATE","oscBot.seqGate",fx.oscBot.seqGate,.05,1,.01)}${padFxSelect("OSC","oscBot.wave",fx.oscBot.wave,[[0,"SAW"],[1,"VINTAGE"],[2,"DETUNE"],[3,"SQUARE"],[4,"RECT"]])}${padFxSelect("SEQ RATE","oscBot.seqRate",fx.oscBot.seqRate,[[0,"1/4"],[1,"1/8"],[2,"1/16"],[3,"1/32"]])}</div><div class="osc-steps pad-osc-steps">${Array.from({length:16},(_,i)=>`<label><span>${i+1}</span><input data-pad-fx-number="oscBot.step${i}" type="number" min="-24" max="24" step="1" value="${fx.oscBot[`step${i}`]}"></label>`).join("")}</div></section>`;
    if(key==="patternSlicer")return `<section class="section fx-settings"><div class="section-head"><h3>PATTERN SLICER SETTINGS</h3><small>CLOCK</small></div><div class="param-grid">${padFxRange("MIX","patternSlicer.mix",fx.patternSlicer.mix,0,1,.01)}${padFxRange("PATTERN","patternSlicer.pattern",fx.patternSlicer.pattern,0,19,1,`${Math.round(fx.patternSlicer.pattern)}`)}${padFxRange("RATE","patternSlicer.rate",fx.patternSlicer.rate,1,16,1,`${Math.round(fx.patternSlicer.rate)}`)}${padFxRange("DUTY","patternSlicer.duty",fx.patternSlicer.duty,.05,.95,.01)}${padFxRange("ATTACK","patternSlicer.attack",fx.patternSlicer.attack,0,.2,.005)}${padFxRange("DEPTH","patternSlicer.depth",fx.patternSlicer.depth,0,1,.01)}</div></section>`;
    if(key==="stepSlicer")return `<section class="section fx-settings"><div class="section-head"><h3>SAMPLE SLICER SETTINGS</h3><small>16 STEP</small></div><div class="param-grid">${padFxRange("MIX","stepSlicer.mix",fx.stepSlicer.mix,0,1,.01)}${padFxRange("RATE","stepSlicer.rate",fx.stepSlicer.rate,1,16,1,`${Math.round(fx.stepSlicer.rate)}`)}${padFxRange("DEPTH","stepSlicer.depth",fx.stepSlicer.depth,0,1,.01)}</div><div class="step-slicer-grid">${Array.from({length:16},(_,i)=>`<input title="STEP ${i+1}" data-pad-fx-param="stepSlicer.step${i}" type="range" min="0" max="1" step=".01" value="${fx.stepSlicer[`step${i}`]}">`).join("")}</div></section>`;
    return "";
  }
  function renderMasterFxSettings(key,f){
    if(key==="filter")return `<section class="section fx-settings"><div class="section-head"><h3>FILTER SETTINGS</h3><small>MASTER</small></div><div class="param-grid">${paramFx("CUTOFF","filter.cutoff",f.filter.cutoff,80,20000,10,`${Math.round(f.filter.cutoff)} Hz`)}</div></section>`;
    if(key==="drive")return `<section class="section fx-settings"><div class="section-head"><h3>DRIVE SETTINGS</h3><small>MASTER</small></div><div class="param-grid">${paramFx("AMOUNT","drive.amount",f.drive.amount,0,1,.01,`${Math.round(f.drive.amount*100)}%`)}</div></section>`;
    if(key==="delay")return `<section class="section fx-settings"><div class="section-head"><h3>DELAY SETTINGS</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","delay.mix",f.delay.mix,0,.75,.01,`${Math.round(f.delay.mix*100)}%`)}${paramFx("FEEDBACK","delay.feedback",f.delay.feedback,0,.82,.01,`${Math.round(f.delay.feedback*100)}%`)}${fxSelect("DIVISION","delay.division",f.delay.division,[["1/4","1/4"],["1/8","1/8"],["1/16","1/16"]])}</div></section>`;
    if(key==="reverb")return `<section class="section fx-settings"><div class="section-head"><h3>REVERB SETTINGS</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","reverb.mix",f.reverb.mix,0,.75,.01,`${Math.round(f.reverb.mix*100)}%`)}${paramFx("SIZE","reverb.size",f.reverb.size,.25,4,.05,`${f.reverb.size.toFixed(2)} s`)}</div></section>`;
    if(key==="stutter")return `<section class="section fx-settings"><div class="section-head"><h3>STUTTER SETTINGS</h3><small>MASTER</small></div><div class="param-grid">${paramFx("DEPTH","stutter.depth",f.stutter.depth,0,1,.01,`${Math.round(f.stutter.depth*100)}%`)}${fxSelect("DIVISION","stutter.division",f.stutter.division,[["1/16","1/16"],["1/32","1/32"]])}</div></section>`;
    if(key==="scatter")return `<section class="section fx-settings"><div class="section-head"><h3>SCATTER</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","scatter.mix",f.scatter.mix,0,1,.01,`${Math.round(f.scatter.mix*100)}%`)}${paramFx("RATE","scatter.rate",f.scatter.rate,1,8,1,`${Math.round(f.scatter.rate)}×`)}${paramFx("DEPTH","scatter.depth",f.scatter.depth,0,1,.01,`${Math.round(f.scatter.depth*100)}%`)}${paramFx("PATTERN","scatter.pattern",f.scatter.pattern,0,7,1,`${Math.round(f.scatter.pattern)}`)}</div></section>`;
    if(key==="glitch")return `<section class="section fx-settings"><div class="section-head"><h3>GLITCH</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","glitch.mix",f.glitch.mix,0,1,.01,`${Math.round(f.glitch.mix*100)}%`)}${paramFx("BITS","glitch.bits",f.glitch.bits,3,16,1,`${Math.round(f.glitch.bits)} bit`)}${paramFx("HOLD","glitch.hold",f.glitch.hold,1,24,1,`${Math.round(f.glitch.hold)} smp`)}${paramFx("DROPOUT","glitch.dropout",f.glitch.dropout,0,.35,.01,`${Math.round(f.glitch.dropout*100)}%`)}</div></section>`;
    if(key==="eq")return `<section class="section fx-settings"><div class="section-head"><h3>4 BAND EQ</h3><small>MASTER</small></div><div class="param-grid">${paramFx("LOW","eq.low",f.eq.low,-12,12,.5,`${f.eq.low>=0?"+":""}${f.eq.low.toFixed(1)} dB`)}${paramFx("LOW MID","eq.lowMid",f.eq.lowMid,-12,12,.5,`${f.eq.lowMid>=0?"+":""}${f.eq.lowMid.toFixed(1)} dB`)}${paramFx("HIGH MID","eq.highMid",f.eq.highMid,-12,12,.5,`${f.eq.highMid>=0?"+":""}${f.eq.highMid.toFixed(1)} dB`)}${paramFx("HIGH","eq.high",f.eq.high,-12,12,.5,`${f.eq.high>=0?"+":""}${f.eq.high.toFixed(1)} dB`)}</div></section>`;
    if(key==="compressor")return `<section class="section fx-settings"><div class="section-head"><h3>COMPRESSOR</h3><small>MASTER BUS</small></div><div class="param-grid">${paramFx("THRESHOLD","compressor.threshold",f.compressor.threshold,-48,0,.5,`${f.compressor.threshold.toFixed(1)} dB`)}${paramFx("RATIO","compressor.ratio",f.compressor.ratio,1,20,.5,`${f.compressor.ratio.toFixed(1)}:1`)}${paramFx("ATTACK","compressor.attack",f.compressor.attack,.001,.2,.001,`${Math.round(f.compressor.attack*1000)} ms`)}${paramFx("RELEASE","compressor.release",f.compressor.release,.03,1,.01,`${Math.round(f.compressor.release*1000)} ms`)}${paramFx("MAKEUP","compressor.makeup",f.compressor.makeup,-6,12,.5,`${f.compressor.makeup>=0?"+":""}${f.compressor.makeup.toFixed(1)} dB`)}</div></section>`;
    if(key==="limiter")return `<section class="section fx-settings"><div class="section-head"><h3>LIMITER</h3><small>FINAL OUTPUT</small></div><div class="param-grid">${paramFx("CEILING","limiter.ceiling",f.limiter.ceiling,-12,0,.1,`${f.limiter.ceiling.toFixed(1)} dB`)}${paramFx("RELEASE","limiter.release",f.limiter.release,.02,.5,.01,`${Math.round(f.limiter.release*1000)} ms`)}</div></section>`;
    if(key==="oscBot")return `<section class="section fx-settings"><div class="section-head"><h3>OSC BOT</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","oscBot.mix",f.oscBot.mix,0,1,.01,`${Math.round(f.oscBot.mix*100)}%`)}${paramFx("BASE NOTE","oscBot.note",f.oscBot.note,24,84,1,`${Math.round(f.oscBot.note)}`)}${paramFx("TONE","oscBot.tone",f.oscBot.tone,-50,50,1,`${Math.round(f.oscBot.tone)}`)}${paramFx("ATTACK","oscBot.attack",f.oscBot.attack,0,100,1,`${Math.round(f.oscBot.attack)}%`)}${paramFx("BALANCE","oscBot.balance",f.oscBot.balance,0,1,.01,`${Math.round(f.oscBot.balance*100)}%`)}${paramFx("SEQ GATE","oscBot.seqGate",f.oscBot.seqGate,.05,1,.01,`${Math.round(f.oscBot.seqGate*100)}%`)}</div><div class="osc-steps">${Array.from({length:16},(_,i)=>`<label><span>${i+1}</span><input data-fx-number="oscBot.step${i}" type="number" min="-24" max="24" step="1" value="${f.oscBot[`step${i}`]}"></label>`).join("")}</div></section>`;
    if(key==="patternSlicer")return `<section class="section fx-settings"><div class="section-head"><h3>PATTERN SLICER</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","patternSlicer.mix",f.patternSlicer.mix,0,1,.01,`${Math.round(f.patternSlicer.mix*100)}%`)}${paramFx("PATTERN","patternSlicer.pattern",f.patternSlicer.pattern,0,19,1,`${Math.round(f.patternSlicer.pattern)}`)}${paramFx("RATE","patternSlicer.rate",f.patternSlicer.rate,1,16,1,`${Math.round(f.patternSlicer.rate)}`)}${paramFx("DUTY","patternSlicer.duty",f.patternSlicer.duty,.05,.95,.01,`${Math.round(f.patternSlicer.duty*100)}%`)}${paramFx("DEPTH","patternSlicer.depth",f.patternSlicer.depth,0,1,.01,`${Math.round(f.patternSlicer.depth*100)}%`)}</div></section>`;
    if(key==="stepSlicer")return `<section class="section fx-settings"><div class="section-head"><h3>SAMPLE SLICER</h3><small>MASTER</small></div><div class="param-grid">${paramFx("MIX","stepSlicer.mix",f.stepSlicer.mix,0,1,.01,`${Math.round(f.stepSlicer.mix*100)}%`)}${paramFx("RATE","stepSlicer.rate",f.stepSlicer.rate,1,16,1,`${Math.round(f.stepSlicer.rate)}`)}${paramFx("DEPTH","stepSlicer.depth",f.stepSlicer.depth,0,1,.01,`${Math.round(f.stepSlicer.depth*100)}%`)}</div><div class="step-slicer-grid">${Array.from({length:16},(_,i)=>`<input title="STEP ${i+1}" data-fx-param="stepSlicer.step${i}" type="range" min="0" max="1" step=".01" value="${f.stepSlicer[`step${i}`]}">`).join("")}</div></section>`;
    return "";
  }
  const FX_LABELS={filter:["FILTER","LOW PASS"],drive:["DRIVE","SATURATION"],delay:["DELAY","TEMPO SYNC"],reverb:["REVERB","TAIL"],stutter:["STUTTER","RHYTHMIC GATE"],scatter:["SCATTER","SLICE REORDER"],glitch:["GLITCH","BIT / HOLD"],oscBot:["OSC BOT","SYNTH / SEQ"],patternSlicer:["PATTERN SLICER","LOOPER FX"],stepSlicer:["SAMPLE SLICER","16 STEP GATE"],eq:["4 BAND EQ","MASTER TONE"],compressor:["COMPRESSOR","BUS GLUE"],limiter:["LIMITER","OUTPUT PROTECT"]};
  function focusedFx(kind,chain){
    if(!chain.length)return null;
    if(kind==="master"){if(!chain.includes(masterFxFocus))masterFxFocus=chain[0];return masterFxFocus;}
    const id=voiceKey(state.currentProgram,state.selectedPad);let key=padFxFocus.get(id);if(!chain.includes(key)){key=chain[0];padFxFocus.set(id,key);}return key;
  }
  function setFocusedFx(kind,key){if(kind==="master")masterFxFocus=key;else padFxFocus.set(voiceKey(state.currentProgram,state.selectedPad),key);}
  function fxRackHtml(kind,chain,fx,available){
    const prefix=kind==="pad"?"pad-":"",focus=focusedFx(kind,chain),options=available.filter(k=>!chain.includes(k));
    return `<section class="section fx-rack"><div class="section-head"><h3>${kind==="pad"?`PAD FX · ${String(state.selectedPad+1).padStart(2,"0")}`:"MASTER FX"}</h3><small>CHAIN</small></div><div class="fx-chain">${chain.length?chain.map((k,i)=>{const [title,sub]=FX_LABELS[k]||[k,k];return `<div class="fx-chain-item ${fx[k]?.on?"on":""} ${focus===k?"selected":""}" data-${prefix}fx-item="${k}" aria-selected="${focus===k?"true":"false"}"><button class="fx-chain-open" type="button"><span>${String(i+1).padStart(2,"0")}</span><strong>${title}</strong><small>${sub}</small></button><div class="fx-chain-actions"><button class="power ${fx[k]?.on?"on":""}" data-${prefix}fx-power="${k}" title="${fx[k]?.on?"Bypass":"Enable"}">●</button><button data-${prefix}fx-move="${k}" data-dir="-1" ${i===0?"disabled":""}>↑</button><button data-${prefix}fx-move="${k}" data-dir="1" ${i===chain.length-1?"disabled":""}>↓</button><button class="remove" data-${prefix}fx-remove="${k}">×</button></div></div>`}).join(""):`<div class="fx-chain-empty">NO FX IN CHAIN</div>`}</div><div class="fx-chain-add"><select data-${prefix}fx-add-select ${options.length?"":"disabled"}>${options.length?options.map(k=>`<option value="${k}">${FX_LABELS[k]?.[0]||k}</option>`).join(""):`<option>CHAIN FULL</option>`}</select><button data-${prefix}fx-add ${options.length?"":"disabled"}>+ ADD FX</button></div></section>`;
  }
  function renderFx(){const p=selectedPad(),fx=p.fx||defaultPadFx();if(!p.source)return `<div class="pad-inspector-empty"><div>PAD ${String(state.selectedPad+1).padStart(2,"0")} VAZIO<br><br>Selecione/carregue um sample para editar seus FX.</div></div>`;const chain=Array.isArray(p.fxChain)?p.fxChain:[],focus=focusedFx("pad",chain);return `${fxRackHtml("pad",chain,fx,PAD_FX_KEYS)}<div class="fx-editor-host" data-pad-fx-editor>${focus?renderPadFxSettings(focus,fx):""}</div>`;}
  function renderMasterFx(){const f=state.fx,chain=Array.isArray(state.fxChain)?state.fxChain:[],focus=focusedFx("master",chain);return `${fxRackHtml("master",chain,f,MASTER_FX_KEYS)}<div class="fx-editor-host" data-master-fx-editor>${focus?renderMasterFxSettings(focus,f):""}</div>`;}
  function renderIo(){const outputSupported=typeof audioCtx?.setSinkId==="function",midiSupported=!!midiRequestFunction(),iosRoute=isIOSLike()&&!outputSupported;return `<section class="section"><div class="section-head"><h3>INTERFACE</h3><small>SKIN</small></div><div class="param"><label><span>SKIN</span></label><select class="quantize-select theme-select" data-theme-select><option value="red-nt" ${state.theme==="red-nt"?"selected":""}>RED NT</option><option value="ocean" ${state.theme==="ocean"?"selected":""}>OCEANO</option><option value="minimal" ${state.theme==="minimal"?"selected":""}>OFF-WHITE</option><option value="minimal-invert" ${state.theme==="minimal-invert"?"selected":""}>OFF-WHITE INVERTED</option></select></div></section><section class="section"><div class="section-head"><h3>AUDIO INTERFACE</h3><small>${outputSupported?"OUTPUT SELECT":"SYSTEM ROUTE"}</small></div><div class="io-audio-actions"><button class="project-btn primary" data-rearm-audio>REARM AUDIO</button><button class="project-btn" data-scan-audio>SCAN AUDIO</button></div><div class="param"><label><span>INPUT</span></label><select class="quantize-select" data-audio-input>${audioDeviceOptions(audioDevices.inputs,audioDevices.selectedInput,"SYSTEM / DEFAULT")}</select></div>${outputSupported?`<div class="param" style="margin-top:8px"><label><span>OUTPUT</span></label><select class="quantize-select" data-audio-output>${audioDeviceOptions(audioDevices.outputs,audioDevices.selectedOutput,"SYSTEM / DEFAULT")}</select></div>`:`<div class="system-audio-route"><b>OUTPUT</b><span>${iosRoute?"iPadOS / interface selected by system":"SYSTEM OUTPUT"}</span></div>`}<p class="help">${outputSupported?"A saída pode ser escolhida diretamente neste navegador.":"Neste iPad/browser não existe setSinkId. A saída física é escolhida pelo iPadOS; o sampler não tenta trocar a interface."}</p></section>${renderMasterFx()}<section class="section"><div class="section-head"><h3>MIDI CONTROLLER</h3><small>${midiSupported?`WEB MIDI · ${midiInputs.length} IN`:"UNAVAILABLE"}</small></div><button class="project-btn ${midiAccess?"":"primary"}" style="width:100%;margin-bottom:8px" data-enable-midi>${midiAccess?"REFRESH MIDI":"ENABLE MIDI"}</button><div class="param"><label><span>MIDI INPUT</span></label><select class="quantize-select" data-midi-input ${midiAccess?"":"disabled"}>${midiDeviceOptions()}</select></div><div class="io-learn-actions"><button class="project-btn primary" data-start-midi-learn>MIDI LEARN VISUAL</button><button class="project-btn" data-start-key-learn>KEYBOARD LEARN VISUAL</button></div><button class="project-btn" style="width:100%;margin-top:8px" data-open-mapping>MAP LIST / CLEANUP</button></section><section class="section"><p class="project-info">Keyboard e MIDI mappings são locais ao dispositivo. PROGRAM 01–08, pads, transport e parâmetros de FX podem ser aprendidos visualmente.</p></section>`;}
  function audioDeviceOptions(list,selected,emptyLabel){return `<option value="" ${!selected?"selected":""}>${emptyLabel}</option>`+list.map((d,i)=>`<option value="${escapeHtml(d.deviceId)}" ${selected===d.deviceId?"selected":""}>${escapeHtml(d.label||`${d.kind.toUpperCase()} ${i+1}`)}</option>`).join("");}
  function midiPortKey(port,index=0){const id=port?.id; if(id!==undefined&&id!==null&&String(id)!=="")return String(id);const manu=String(port?.manufacturer||"").trim(),name=String(port?.name||"").trim();return `legacy:${manu}:${name}:${index}`;}
  function midiDeviceOptions(){const selected=midiInput?midiPortKey(midiInput,Math.max(0,midiInputs.indexOf(midiInput))):"";return `<option value="">NONE</option>`+midiInputs.map((d,i)=>{const key=midiPortKey(d,i);return `<option value="${escapeHtml(key)}" ${selected===key?"selected":""}>${escapeHtml(d.name||d.manufacturer||`MIDI ${i+1}`)}</option>`}).join("");}
  function renderProject(){return `<section class="section"><div class="section-head"><h3>PROJECT</h3><small>PORTABLE</small></div><div class="param"><label><span>NOME</span></label><input class="search" data-project-name value="${escapeHtml(state.projectName)}"></div><p class="help" style="margin-top:8px">Salvar Projeto gera um arquivo .ntsampler com samples locais incorporados.</p><div class="project-grid"><button class="project-btn primary" data-save-project>SALVAR PROJETO</button><button class="project-btn" data-open-project>ABRIR PROJETO</button><button class="project-btn" data-save-browser>SALVAR NO DEVICE</button><button class="project-btn" data-new-project>NOVO</button></div></section><section class="section"><div class="section-head"><h3>PERFORMANCE REC</h3><small>MASTER OUT</small></div><button class="project-btn ${mediaRecorder?.state==="recording"?"primary":""}" style="width:100%" data-rec-master>${mediaRecorder?.state==="recording"?"PARAR E EXPORTAR":"REC MASTER"}</button>${pendingMasterExport?`<button class="project-btn primary" style="width:100%;margin-top:7px" data-save-last-master>SALVAR ÚLTIMA GRAVAÇÃO</button>`:""}</section><section class="section"><p class="project-info">NT Sampler ${VERSION}<br>Clock: AudioContext.currentTime<br>Scheduler: 25 ms / lookahead 120 ms<br>${latencyText()}<br>Advanced FX: ${workletsReady?"READY":"FALLBACK"}</p></section>`;}

  function renderEditor(){const e=state.editor,p=currentProgram().pads[e.padIndex],dur=e.buffer.duration,view=editorView();const left=(e.start-view.start)/view.duration*100,right=100-(e.end-view.start)/view.duration*100,ph=(e.playhead-view.start)/view.duration*100;return `<div class="editor-backdrop" data-editor-backdrop><section class="editor"><header class="editor-head"><div><small>PAD ${String(e.padIndex+1).padStart(2,"0")} · PRECISION TRIM</small><h2>${escapeHtml(p.source.name)}</h2></div><button class="close-editor" data-close-editor>×</button></header><div class="wave-editor" data-wave-editor><canvas data-editor-wave></canvas><div class="wave-grid" data-wave-grid></div><div class="wave-mask" data-mask-left style="left:0;width:${clamp(left,0,100)}%"></div><div class="wave-mask" data-mask-right style="right:0;width:${clamp(right,0,100)}%"></div><div class="wave-selection" data-wave-selection style="left:${clamp(left,0,100)}%;right:${clamp(right,0,100)}%"></div><div class="trim-handle in" data-handle="in" style="left:${clamp(left,0,100)}%"></div><div class="trim-handle out" data-handle="out" style="left:${clamp(100-right,0,100)}%"></div><div class="editor-playhead" data-editor-playhead style="left:${clamp(ph,0,100)}%"></div><div class="wave-ruler" data-wave-ruler></div></div><div class="precision-row"><div class="precision-box"><label>IN</label><input class="time-input" data-time-in type="number" step="1" min="0" max="${Math.floor(dur*1000)}" value="${Math.round(e.start*1000)}"><button class="nudge-btn" data-nudge="in:-1">-1</button><button class="nudge-btn" data-nudge="in:1">+1</button></div><div class="precision-box"><label>OUT</label><input class="time-input" data-time-out type="number" step="1" min="0" max="${Math.floor(dur*1000)}" value="${Math.round(e.end*1000)}"><button class="nudge-btn" data-nudge="out:-1">-1</button><button class="nudge-btn" data-nudge="out:1">+1</button></div><button class="snap-btn ${e.snap?"on":""}" data-snap>ZERO CROSS ${e.snap?"ON":"OFF"}</button></div><div class="editor-controls"><div class="zoom-control"><label>ZOOM ${e.zoom.toFixed(1)}× · SELECTION ${fmtTime(e.end-e.start)} · GRID ${Math.round(state.tempo)} BPM</label><input data-editor-zoom type="range" min="1" max="64" step=".25" value="${e.zoom}"></div><div class="zoom-control"><label>VIEW CENTER · CURSOR ${fmtTime(e.playhead)}</label><input data-editor-center type="range" min="0" max="${dur}" step=".001" value="${e.center}"></div><div class="editor-actions"><button class="audition-btn ${e.audition?"on":""}" data-audition-editor>${e.audition?"■ STOP":"▶ AUDITION"}</button><button class="audition-loop ${e.auditionLoop?"on":""}" data-audition-loop>LOOP ${e.auditionLoop?"ON":"OFF"}</button><button data-export-trim>EXPORT WAV</button><button data-close-editor>CANCEL</button><button class="apply" data-apply-editor>APPLY</button></div></div></section></div>`;}

  function renderPatternModal(){const program=currentProgram(),p=program.pattern,steps=p.events.length;const bank=Array.from({length:PATTERN_SLOT_COUNT},(_,i)=>{const q=program.patterns?.[i],has=q?.events?.some(e=>e.length),active=i===program.activePattern;return `<button class="pattern-launch-slot ${active?"active":""} ${q?"exists":"empty"}" data-pattern-launch="${i}" title="${escapeHtml(q?.name||`EMPTY ${String(i+1).padStart(2,"0")}`)}"><b>${String(i+1).padStart(2,"0")}</b><span>${q?escapeHtml(q.name||"PATTERN"):"EMPTY"}</span>${has?"<i></i>":""}</button>`}).join("");return `<div class="editor-backdrop pattern-backdrop" data-pattern-backdrop><section class="pattern-modal"><header class="pattern-head"><div class="pattern-heading"><small>PROGRAM ${String(state.currentProgram+1).padStart(2,"0")} · PATTERN PERFORMANCE / EDITOR</small><input class="pattern-modal-name" data-pattern-name-modal value="${escapeHtml(p.name||`PATTERN ${String(program.activePattern+1).padStart(2,"0")}`)}" maxlength="32"></div><div class="pattern-head-actions"><label>BEATS <input data-pattern-beats type="number" min="1" max="64" step="1" value="${p.beats}"></label><label>COPY TO <select data-pattern-copy-target-modal>${Array.from({length:PATTERN_SLOT_COUNT},(_,i)=>`<option value="${i}" ${suggestedDuplicateTarget(program)===i?"selected":""} ${program.patterns?.[i]||i===program.activePattern?"disabled":""}>${String(i+1).padStart(2,"0")}</option>`).join("")}</select></label><button class="small-btn" data-duplicate-pattern-modal>DUP</button><button class="record-pattern ${state.patternRecord?"on":""}" data-pattern-record-modal>● REC</button><button class="icon-btn primary transport-main modal-transport ${state.transport?"running":""}" data-pattern-play><span class="transport-glyph ${state.transport?"pause":"play"}" aria-hidden="true"></span><small>${state.transport?"PAUSE":"PLAY"}</small></button><button class="danger-btn" data-pattern-clear-modal>CLEAR</button><button class="close-editor" data-close-modal>×</button></div></header><div class="pattern-modal-body"><aside class="pattern-launcher"><div class="pattern-launcher-head"><b>PATTERNS</b><span>tap = launch / select</span></div><div class="pattern-launch-grid">${bank}</div></aside><div class="pattern-scroll"><div class="pattern-rack" style="--seq-steps:${steps}"><div class="seq-corner">PAD</div><div class="seq-header">${Array.from({length:steps},(_,i)=>`<span class="seq-tick ${i%16===0?"bar":""} ${i%4===0?"beat":""}" data-seq-head="${i}">${i%4===0?Math.floor(i/4)+1:""}</span>`).join("")}</div>${currentProgram().pads.map((pad,pi)=>`<button class="seq-label" data-seq-audition="${pi}"><b>${String(pi+1).padStart(2,"0")}</b><span>${escapeHtml(pad.source?.name||"EMPTY")}</span></button><div class="seq-row" data-seq-row="${pi}">${Array.from({length:steps},(_,si)=>`<button class="seq-cell ${p.events[si]?.includes(pi)?"on":""} ${si%16===0?"bar":""} ${si%4===0?"beat":""}" data-seq-pad="${pi}" data-seq-step="${si}"></button>`).join("")}</div>`).join("")}</div></div></div><footer class="pattern-footer"><span>1 step = 1/16 · 4 steps = 1 beat · máximo 64 beats</span><span>Selecione um slot à esquerda para disparar/editar. CLICK/DRAG pinta ou apaga steps.</span></footer></section></div>`;}

  function mappingForAction(map,actionId){return Object.entries(map).filter(([,m])=>m?.actionId===actionId).map(([k])=>k);}
  function mappingTargets(){
    const list=Array.from({length:16},(_,i)=>({id:`pad_${i}`,label:`PAD ${String(i+1).padStart(2,"0")}`,kind:"trigger"}));
    for(let i=0;i<PROGRAM_COUNT;i++){list.push({id:`program_${i}`,label:`PROGRAM ${String(i+1).padStart(2,"0")}`,kind:"trigger"});list.push({id:`program_stop_${i}`,label:`PROGRAM ${String(i+1).padStart(2,"0")} · STOP`,kind:"trigger"});list.push({id:`program_mute_${i}`,label:`PROGRAM ${String(i+1).padStart(2,"0")} · MUTE`,kind:"trigger"});list.push({id:`program_solo_${i}`,label:`PROGRAM ${String(i+1).padStart(2,"0")} · SOLO`,kind:"trigger"});}
    list.push({id:"program_prev",label:"PROGRAM · PREVIOUS",kind:"trigger"},{id:"program_next",label:"PROGRAM · NEXT",kind:"trigger"},{id:"transport",label:"PLAY / PAUSE",kind:"trigger"},{id:"stop_all",label:"STOP ALL",kind:"trigger"},{id:"tap",label:"TAP TEMPO",kind:"trigger"});
    for(const key of PAD_FX_KEYS)list.push({id:`padfx_toggle_${key}`,label:`SELECTED PAD · ${key.replace(/([A-Z])/g," $1").toUpperCase()} ON/OFF`,kind:"trigger"});
    const padSpecs=[["drive.amount","DRIVE",0,1,.01],["delay.mix","DELAY MIX",0,.8,.01],["delay.feedback","DELAY FB",0,.82,.01],["reverb.mix","REVERB MIX",0,.8,.01],["reverb.size","REVERB SIZE",.25,4,.05],["stutter.depth","STUTTER DEPTH",0,1,.01],["scatter.mix","SCATTER MIX",0,1,.01],["scatter.rate","SCATTER RATE",1,8,1],["scatter.depth","SCATTER DEPTH",0,1,.01],["scatter.pattern","SCATTER PATTERN",0,7,1],["glitch.mix","GLITCH MIX",0,1,.01],["glitch.bits","GLITCH BITS",3,16,1],["glitch.hold","GLITCH HOLD",1,24,1],["glitch.dropout","GLITCH DROPOUT",0,.35,.01],["oscBot.mix","OSC MIX",0,1,.01],["oscBot.dryInput","OSC DRY",0,1,.01],["oscBot.note","OSC NOTE",24,84,1],["oscBot.tone","OSC TONE",-50,50,1],["oscBot.attack","OSC ATTACK",0,100,1],["oscBot.sens","OSC SENS",0,1,.01],["oscBot.balance","OSC BALANCE",0,1,.01],["oscBot.seqGate","OSC SEQ GATE",.05,1,.01],["oscBot.wave","OSC WAVE",0,4,1],["oscBot.seqRate","OSC RATE",0,3,1],["patternSlicer.mix","PATTERN MIX",0,1,.01],["patternSlicer.pattern","PATTERN",0,19,1],["patternSlicer.rate","PATTERN RATE",1,16,1],["patternSlicer.duty","PATTERN DUTY",.05,.95,.01],["patternSlicer.attack","PATTERN ATTACK",0,.2,.005],["patternSlicer.depth","PATTERN DEPTH",0,1,.01],["stepSlicer.mix","SAMPLE MIX",0,1,.01],["stepSlicer.rate","SAMPLE RATE",1,16,1],["stepSlicer.depth","SAMPLE DEPTH",0,1,.01]];
    for(const [path,label,min,max,step] of padSpecs)list.push({id:`padfx_param_${path}`,label:`SELECTED PAD · ${label}`,kind:"param",spec:{path,label,min,max,step,keyStep:step}});
    for(let i=0;i<16;i++){list.push({id:`padfx_param_oscBot.step${i}`,label:`SELECTED PAD · OSC STEP ${i+1}`,kind:"param",spec:{path:`oscBot.step${i}`,label:`OSC STEP ${i+1}`,min:-24,max:24,step:1,keyStep:1}});list.push({id:`padfx_param_stepSlicer.step${i}`,label:`SELECTED PAD · SAMPLE STEP ${i+1}`,kind:"param",spec:{path:`stepSlicer.step${i}`,label:`SAMPLE STEP ${i+1}`,min:0,max:1,step:.01,keyStep:.05}});}
    for(const key of ["filter","drive","delay","reverb","stutter","scatter","glitch","oscBot","patternSlicer","stepSlicer","eq","compressor","limiter"])list.push({id:`fx_toggle_${key}`,label:`MASTER FX · ${key.replace(/([A-Z])/g," $1").toUpperCase()} ON/OFF`,kind:"trigger"});for(const spec of fxMappingSpecs())list.push({id:`fx_param_${spec.path}`,label:`MASTER FX · ${spec.label}`,kind:"param",spec});return list;
  }
  function renderLearnToolbar(){if(!visualLearnMode)return "";const status=visualLearnArmed?`${visualLearnArmed.label} · ${visualLearnMode==="midi"?"MOVE MIDI":"PRESS KEY"}`:(visualLearnRemove?"TOQUE NUM CONTROLE PARA REMOVER":"TOQUE NUM CONTROLE PARA MAPEAR");return `<aside class="learn-toolbar"><strong>${visualLearnMode==="midi"?"MIDI LEARN":"KEYBOARD LEARN"}</strong><span>${escapeHtml(status)}</span><div class="learn-toolbar-actions"><button class="${visualLearnRemove?"active":""}" data-learn-remove>REMOVE</button><button data-learn-list>LIST</button><button data-learn-done>DONE</button></div></aside>`;}
  async function startVisualLearn(mode){if(mode==="midi"&&!midiAccess&&!(await enableMidi()))return;visualLearnMode=mode;visualLearnRemove=false;visualLearnArmed=null;midiLearnTarget=null;keyboardLearnTarget=null;state.modal=null;renderMain();}
  function stopVisualLearn(){visualLearnMode=null;visualLearnRemove=false;visualLearnArmed=null;midiLearnTarget=null;keyboardLearnTarget=null;renderMain();}
  function hasActionMapping(map,id){return Object.values(map).some(m=>m?.actionId===id);}
  function tagLearn(el,id,label){if(!el||!targetById(id))return;el.dataset.learnAction=id;el.dataset.learnLabel=label;el.classList.add("learn-target");const map=visualLearnMode==="keyboard"?keyboardMappings:midiMappings;el.classList.toggle("learn-mapped",hasActionMapping(map,id));el.classList.toggle("learn-armed",visualLearnArmed?.id===id);}
  function syncVisualLearnTargets(){document.documentElement.classList.toggle("learn-active",!!visualLearnMode);document.documentElement.classList.toggle("learn-remove",!!visualLearnMode&&visualLearnRemove);if(!visualLearnMode)return;tagLearn(document.querySelector("[data-program-prev]"),"program_prev","PROGRAM · PREVIOUS");tagLearn(document.querySelector("[data-program-next]"),"program_next","PROGRAM · NEXT");document.querySelectorAll("[data-program]").forEach(el=>{const i=Number(el.dataset.program);tagLearn(el,`program_${i}`,`PROGRAM ${String(i+1).padStart(2,"0")}`)});document.querySelectorAll("[data-program-stop]").forEach(el=>{const i=Number(el.dataset.programStop);tagLearn(el,`program_stop_${i}`,`PROGRAM ${String(i+1).padStart(2,"0")} · STOP`)});document.querySelectorAll("[data-program-mute]").forEach(el=>{const i=Number(el.dataset.programMute);tagLearn(el,`program_mute_${i}`,`PROGRAM ${String(i+1).padStart(2,"0")} · MUTE`)});document.querySelectorAll("[data-program-solo]").forEach(el=>{const i=Number(el.dataset.programSolo);tagLearn(el,`program_solo_${i}`,`PROGRAM ${String(i+1).padStart(2,"0")} · SOLO`)});document.querySelectorAll("[data-pad]").forEach(el=>{const i=Number(el.dataset.pad);tagLearn(el,`pad_${i}`,`PAD ${String(i+1).padStart(2,"0")}`)});tagLearn(document.querySelector("[data-transport]"),"transport","PLAY / PAUSE");tagLearn(document.querySelector("[data-stop-all]"),"stop_all","STOP ALL");tagLearn(document.querySelector("[data-tap]"),"tap","TAP TEMPO");tagLearn(document.querySelector("[data-master-volume]"),"fx_param_masterDb","MASTER VOLUME");document.querySelectorAll("[data-pad-fx-toggle],[data-pad-fx-power]").forEach(el=>{const k=el.dataset.padFxToggle||el.dataset.padFxPower;tagLearn(el,`padfx_toggle_${k}`,`PAD FX ${k}`)});document.querySelectorAll("[data-pad-fx-param]").forEach(el=>{const path=el.dataset.padFxParam;tagLearn(el,`padfx_param_${path}`,`PAD FX ${path}`)});document.querySelectorAll("[data-pad-fx-select]").forEach(el=>{const path=el.dataset.padFxSelect;tagLearn(el,`padfx_param_${path}`,`PAD FX ${path}`)});document.querySelectorAll("[data-pad-fx-number]").forEach(el=>{const path=el.dataset.padFxNumber;tagLearn(el,`padfx_param_${path}`,`PAD FX ${path}`)});document.querySelectorAll("[data-fx-toggle],[data-fx-power]").forEach(el=>{const k=el.dataset.fxToggle||el.dataset.fxPower;tagLearn(el,`fx_toggle_${k}`,`MASTER FX ${k}`)});document.querySelectorAll("[data-fx-param]").forEach(el=>{const path=el.dataset.fxParam;tagLearn(el,`fx_param_${path}`,`MASTER FX ${path}`)});document.querySelectorAll("[data-fx-number]").forEach(el=>{const path=el.dataset.fxNumber;tagLearn(el,`fx_param_${path}`,`MASTER FX ${path}`)});}
  function handleVisualLearnPointer(event){if(!visualLearnMode)return;const el=event.target.closest?.("[data-learn-action]");if(!el)return;event.preventDefault();event.stopImmediatePropagation();const t=targetById(el.dataset.learnAction);if(!t)return;if(visualLearnRemove){const map=visualLearnMode==="keyboard"?keyboardMappings:midiMappings;clearMappingsForAction(map,t.id);saveStoredMap(visualLearnMode==="keyboard"?"nt-sampler-keyboard-map":"nt-sampler-midi-map",map);visualLearnArmed=null;syncVisualLearnTargets();notice(`${t.label} · mapping removido`,"ok",true);return;}visualLearnArmed=t;if(visualLearnMode==="midi"){midiLearnTarget=t;keyboardLearnTarget=null;}else{keyboardLearnTarget=t;midiLearnTarget=null;}syncVisualLearnTargets();}
  function bindLearnToolbar(){document.querySelector("[data-learn-done]")?.addEventListener("click",stopVisualLearn);document.querySelector("[data-learn-remove]")?.addEventListener("click",()=>{visualLearnRemove=!visualLearnRemove;visualLearnArmed=null;midiLearnTarget=null;keyboardLearnTarget=null;renderMain();});document.querySelector("[data-learn-list]")?.addEventListener("click",()=>{state.modal="mapping";renderMain();});}
  function updateMasterCompactUi(){const v=document.querySelector("[data-master-volume-value]"),r=document.querySelector("[data-master-volume]");if(v)v.textContent=`${state.fx.masterDb>=0?"+":""}${state.fx.masterDb.toFixed(1)} dB`;if(r&&document.activeElement!==r)r.value=state.fx.masterDb;}

  function renderMappingModal(){const targets=mappingTargets();return `<div class="editor-backdrop mapping-backdrop" data-mapping-backdrop><section class="mapping-modal"><header class="editor-head"><div><small>CONTROLLER ASSIGNMENTS</small><h2>MIDI + KEYBOARD MAP</h2></div><div class="mapping-top-actions"><button data-clear-midi-all>CLEAR MIDI</button><button data-clear-key-all>CLEAR KEYBOARD</button><button class="close-editor" data-close-modal>×</button></div></header><div class="mapping-status">${midiLearnTarget?`MIDI LEARN · ${escapeHtml(midiLearnTarget.label)} · mova um CC ou toque uma nota`:keyboardLearnTarget?`KEYBOARD LEARN · ${escapeHtml(keyboardLearnTarget.label)} · pressione uma tecla`:"Selecione MIDI ou KEY em qualquer linha. ESC cancela o learn."}</div><div class="mapping-list">${targets.map(t=>{const mm=mappingForAction(midiMappings,t.id),km=mappingForAction(keyboardMappings,t.id);return `<div class="mapping-row ${midiLearnTarget?.id===t.id||keyboardLearnTarget?.id===t.id?"armed":""}"><span class="mapping-name"><b>${escapeHtml(t.label)}</b><small>${t.kind==="param"?"CC = absoluto · key = + / Shift = -":"trigger"}</small></span><span class="mapping-value">${mm.length?escapeHtml(mm.join(", ").toUpperCase()):"—"}</span><button data-learn-midi="${escapeHtml(t.id)}">MIDI</button><button class="map-clear" data-clear-midi-action="${escapeHtml(t.id)}">×</button><span class="mapping-value">${km.length?escapeHtml(km.map(humanKey).join(", ")):"—"}</span><button data-learn-key="${escapeHtml(t.id)}">KEY</button><button class="map-clear" data-clear-key-action="${escapeHtml(t.id)}">×</button></div>`}).join("")}</div></section></div>`;}



  function closeModal(){midiLearnTarget=null;keyboardLearnTarget=null;mappingPaint=null;state.modal=null;renderMain();}
  function bindPatternModal(){
    document.querySelector("[data-pattern-backdrop]")?.addEventListener("pointerdown",e=>{if(e.target===e.currentTarget)closeModal();});
    document.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",closeModal));
    document.querySelector("[data-pattern-play]")?.addEventListener("click",()=>{toggleTransport();renderMain();});
    document.querySelectorAll("[data-pattern-launch]").forEach(b=>b.addEventListener("click",()=>launchPatternSlot(Number(b.dataset.patternLaunch))));
    const modalName=document.querySelector("[data-pattern-name-modal]");if(modalName){modalName.addEventListener("change",()=>renameCurrentPattern(modalName.value));modalName.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();modalName.blur();}});}
    document.querySelector("[data-duplicate-pattern-modal]")?.addEventListener("click",()=>duplicatePatternTo(Number(document.querySelector("[data-pattern-copy-target-modal]")?.value)));
    document.querySelector("[data-pattern-record-modal]")?.addEventListener("click",()=>{const on=!state.patternRecord;if(on)pushHistory();state.patternRecord=on;if(on&&!state.transport)startTransport();renderMain();});
    document.querySelector("[data-pattern-clear-modal]")?.addEventListener("click",clearPattern);
    document.querySelector("[data-pattern-beats]")?.addEventListener("change",e=>setPatternBeats(e.target.value));
    document.querySelectorAll("[data-seq-audition]").forEach(b=>b.addEventListener("pointerdown",async e=>{e.preventDefault();const pi=Number(b.dataset.seqAudition);state.selectedPad=pi;const key=voiceKey(state.currentProgram,pi),old=patternPreviewVoices.get(key);if(old&&!old.ended){releaseVoice(old.programIndex,old.padIndex,old,null,STOP_FADE);patternPreviewVoices.delete(key);return;}if(currentProgram().pads[pi].source){const v=await triggerPad(pi,{programIndex:state.currentProgram,forceFree:true,patternPreview:true,recordHit:false});if(v)patternPreviewVoices.set(key,v);}}));
    document.querySelectorAll(".seq-cell").forEach(cell=>{
      cell.addEventListener("pointerdown",e=>{e.preventDefault();const pi=Number(cell.dataset.seqPad),si=Number(cell.dataset.seqStep),on=!currentProgram().pattern.events[si]?.includes(pi);pushHistory();mappingPaint={on};setPatternStep(pi,si,on);window.addEventListener("pointerup",()=>{mappingPaint=null;queueAutosave();},{once:true});});
      cell.addEventListener("pointerenter",()=>{if(!mappingPaint)return;setPatternStep(Number(cell.dataset.seqPad),Number(cell.dataset.seqStep),mappingPaint.on);});
      cell.addEventListener("pointerup",()=>{mappingPaint=null;queueAutosave();});cell.addEventListener("pointercancel",()=>{mappingPaint=null;queueAutosave();});
    });
  }
  function setPatternStep(padIndex,step,on){const ev=currentProgram().pattern.events[step];if(!ev)return;const has=ev.includes(padIndex);if(on&&!has)ev.push(padIndex);else if(!on&&has)ev.splice(ev.indexOf(padIndex),1);const cell=document.querySelector(`.seq-cell[data-seq-pad="${padIndex}"][data-seq-step="${step}"]`);cell?.classList.toggle("on",on);renderPatternOnly();queueAutosave();}

  async function scanAudioDevices(requestPermission=true){
    if(!navigator.mediaDevices?.enumerateDevices){notice("Lista de interfaces não disponível neste navegador.","warn",true);return;}
    try{
      // Web MIDI Browser/iPad can change the iOS audio session/route when getUserMedia is opened.
      // A passive scan is safer there; request input permission only when the user actually selects an input.
      if(requestPermission&&!isIOSWebMidiHost()&&navigator.mediaDevices.getUserMedia){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());}
      const list=await navigator.mediaDevices.enumerateDevices();audioDevices.inputs=list.filter(d=>d.kind==="audioinput");audioDevices.outputs=list.filter(d=>d.kind==="audiooutput");
      if(audioDevices.selectedInput&&!audioDevices.inputs.some(d=>d.deviceId===audioDevices.selectedInput))audioDevices.selectedInput="";
      if(audioDevices.selectedOutput&&!audioDevices.outputs.some(d=>d.deviceId===audioDevices.selectedOutput))audioDevices.selectedOutput="";
      preferPlaybackAudioSession();await ensureAudioReady({force:true});
      if(state.tab==="io")refreshSidePanel();notice(`${audioDevices.inputs.length} input(s) · ${audioDevices.outputs.length} output(s) encontrados.`,"ok",true);
    }catch(err){console.warn(err);preferPlaybackAudioSession();await ensureAudioReady({force:true});notice("Não consegui atualizar a lista de áudio.","warn",true);}
  }
  async function selectAudioInput(id){audioDevices.selectedInput=id||"";safeStorageSet("nt-sampler-audio-input",audioDevices.selectedInput);if(!id){preferPlaybackAudioSession();await ensureAudioReady({force:true});notice("Entrada: sistema/default.","ok",true);return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:id}}});stream.getTracks().forEach(t=>t.stop());preferPlaybackAudioSession();await ensureAudioReady({force:true});notice("Interface de entrada selecionada.","ok",true);}catch{preferPlaybackAudioSession();await ensureAudioReady({force:true});notice("Não foi possível abrir esta entrada.","warn",true);}}
  async function selectAudioOutput(id){const ctx=getContext();if(typeof ctx.setSinkId!=="function")return;try{await ctx.setSinkId(id||"");audioDevices.selectedOutput=id||"";safeStorageSet("nt-sampler-audio-output",audioDevices.selectedOutput);await ensureAudioReady({force:true});notice("Saída de áudio atualizada.","ok",true);}catch(err){console.warn(err);notice("Não foi possível selecionar esta saída.","warn",true);}}
  async function applySavedAudioOutput(){if(audioDevices.selectedOutput&&typeof getContext().setSinkId==="function")try{await getContext().setSinkId(audioDevices.selectedOutput);}catch{audioDevices.selectedOutput="";}}

  function midiAutoEnabled(){return safeStorageGet("nt-sampler-midi-auto")==="1"||!!safeStorageGet("nt-sampler-midi-input")||Object.keys(midiMappings).length>0;}
  function midiRequestFunction(){return navigator.requestMIDIAccess||navigator.webkitRequestMIDIAccess||navigator.mozRequestMIDIAccess||null;}
  function isIOSMidiHost(){return /iPad|iPhone|iPod/i.test(navigator.userAgent||"")||(navigator.platform==="MacIntel"&&Number(navigator.maxTouchPoints)>1);}
  function midiPortsToArray(collection){
    if(!collection)return [];
    const out=[],seen=new Set(),push=port=>{if(!port||seen.has(port))return;seen.add(port);out.push(port);};
    // Web MIDI Browser 1.0.6 implements the 2016 MIDIInputMap imperfectly. forEach is the safest path there.
    try{if(typeof collection.forEach==="function")collection.forEach((a,b)=>{const looks=x=>x&&typeof x==="object"&&("name" in x||"id" in x||"type" in x||"onmidimessage" in x);push(looks(a)?a:looks(b)?b:null);});}catch(err){console.warn("MIDI forEach compatibility",err);}
    if(out.length)return out;
    try{if(typeof collection.values==="function"){const values=collection.values();if(values){if(typeof values[Symbol.iterator]==="function"){for(const port of values)push(port);}else if(typeof values.next==="function"){for(let step=values.next(),guard=0;step&&!step.done&&guard<256;step=values.next(),guard++)push(step.value);}}}}catch(err){console.warn("MIDI values compatibility",err);}
    if(out.length)return out;
    try{if(typeof collection.length==="number")for(let i=0;i<collection.length;i++)push(collection[i]);}catch{}
    if(out.length)return out;
    try{for(const key of Object.keys(collection)){const value=collection[key];if(value&&typeof value==="object"&&("name" in value||"id" in value||"type" in value))push(value);}}catch{}
    return out;
  }
  function requestMidiAccessOnce(fn,args){try{const result=args===undefined?fn.call(navigator):fn.call(navigator,args);if(result&&typeof result.then==="function")return result;return Promise.resolve(result);}catch(err){return Promise.reject(err);}}
  async function waitForMidiRequestFunction(timeout=1200){const started=Date.now();let fn=midiRequestFunction();while(!fn&&Date.now()-started<timeout){await new Promise(r=>setTimeout(r,60));fn=midiRequestFunction();}return fn;}
  async function requestMidiAccessCompat(){
    const fn=midiRequestFunction();if(!fn)throw new Error("WEB_MIDI_UNAVAILABLE");
    // The old iOS Web MIDI Browser is happiest with the classic no-SysEx request and its map.forEach implementation.
    // First try the standards call. On iOS only, retry without an options object if the injected Promise stalls.
    const primary=requestMidiAccessOnce(fn,{sysex:false});
    if(!isIOSMidiHost())return primary;
    let timer=0;try{return await Promise.race([primary,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("MIDI_REQUEST_TIMEOUT")),2200);})]);}
    catch(err){console.warn("MIDI iOS first request retry",err);return await requestMidiAccessOnce(fn,undefined);}
    finally{if(timer)clearTimeout(timer);}
  }
  function bindMidiAccessState(access){if(!access)return;const refresh=()=>{setTimeout(()=>refreshMidiInputs(),0);setTimeout(()=>refreshMidiInputs(),120);};try{if(typeof access.addEventListener==="function")access.addEventListener("statechange",refresh);else access.onstatechange=refresh;}catch{try{access.onstatechange=refresh;}catch{}}}
  async function enableMidi(options={}){
    const silent=!!options.silent;let fn=midiRequestFunction();if(!fn&&isIOSMidiHost())fn=await waitForMidiRequestFunction();if(!fn){if(!silent)notice("Web MIDI não está disponível neste navegador. No iPad, abra pelo Web MIDI Browser.","warn",true);return false;}
    if(midiAccess){refreshMidiInputs();if(!silent)notice(`MIDI pronto · ${midiInputs.length} input(s).`,"ok",true);return true;}
    try{midiAccess=await requestMidiAccessCompat();if(!midiAccess)throw new Error("MIDI_ACCESS_EMPTY");safeStorageSet("nt-sampler-midi-auto","1");bindMidiAccessState(midiAccess);refreshMidiInputs();setTimeout(()=>refreshMidiInputs(),120);setTimeout(()=>refreshMidiInputs(),600);if(state.tab==="io")refreshSidePanel();if(!silent)notice(`MIDI pronto · ${midiInputs.length} input(s).`,midiInputs.length?"ok":"warn",true);return true;}catch(err){console.warn("MIDI access failed",err);midiAccess=null;if(!silent)notice(`MIDI não abriu (${err?.message||"erro"}). No Web MIDI Browser, confirme o controller na tela inicial e toque REFRESH MIDI.`,"warn",true);return false;}
  }
  function autoInitMidi(){if(midiAutoEnabled())enableMidi({silent:true}).catch(()=>{});}
  function refreshMidiInputs(){
    if(!midiAccess)return;
    const list=midiPortsToArray(midiAccess.inputs);midiInputs=list;
    const saved=safeStorageGet("nt-sampler-midi-input"),current=midiInput?midiPortKey(midiInput,Math.max(0,list.indexOf(midiInput))):"",wanted=current||saved;
    const wantedIndex=list.findIndex((d,i)=>midiPortKey(d,i)===wanted);
    if(wanted&&wantedIndex>=0)selectMidiInput(midiPortKey(list[wantedIndex],wantedIndex),false,true);
    else if(list.length===1)selectMidiInput(midiPortKey(list[0],0),false,true);
    else if(midiInput&&!list.includes(midiInput))selectMidiInput("",false,!!saved);
    if(state.tab==="io")refreshSidePanel();
  }
  function detachMidiInput(port){if(!port)return;try{if(typeof port.removeEventListener==="function")port.removeEventListener("midimessage",handleMidiMessage);}catch{}try{if(port.onmidimessage===handleMidiMessage)port.onmidimessage=null;}catch{}}
  function attachMidiInput(port){if(!port)return;let attached=false;try{if(typeof port.addEventListener==="function"){port.addEventListener("midimessage",handleMidiMessage);attached=true;}}catch{}if(!attached)try{port.onmidimessage=handleMidiMessage;}catch(err){console.warn("MIDI input handler",err);}}
  function selectMidiInput(id,notifyUser=true,preserveSaved=false){
    detachMidiInput(midiInput);const index=midiInputs.findIndex((d,i)=>midiPortKey(d,i)===String(id||""));midiInput=index>=0?midiInputs[index]:null;
    if(midiInput){attachMidiInput(midiInput);safeStorageSet("nt-sampler-midi-input",midiPortKey(midiInput,index));}else if(!preserveSaved)safeStorageRemove("nt-sampler-midi-input");
    if(notifyUser){if(state.tab==="io")refreshSidePanel();notice(midiInput?`MIDI: ${midiInput.name||midiInput.manufacturer||"controller"}`:"MIDI input desligado.","ok",true);}
  }
  function handleMidiMessage(event){const [st,d1=0,d2=0]=event.data||[],type=st&0xf0;let key=null,value=0,midiKind="other";if(type===0xb0){key=`cc_${d1}`;value=d2/127;midiKind="cc";}else if(type===0x90||type===0x80){key=`note_${d1}`;value=type===0x90&&d2>0?d2/127:0;midiKind="note";}else return;
    if(midiLearnTarget&&value>0){if(midiLearnTarget.kind==="param"&&type!==0xb0){notice("Para parâmetros, mova um MIDI CC.","warn",true);return;}clearMappingsForAction(midiMappings,midiLearnTarget.id);midiMappings[key]={actionId:midiLearnTarget.id,label:midiLearnTarget.label};saveStoredMap("nt-sampler-midi-map",midiMappings);const label=midiLearnTarget.label;midiLearnTarget=null;visualLearnArmed=null;notice(`MIDI mapeado: ${label}`,"ok",true);if(visualLearnMode)syncVisualLearnTargets();else renderMain();return;}
    if(visualLearnMode==="midi")return;const map=midiMappings[key];if(!map)return;
    const isPad=map.actionId.startsWith("pad_"),isPageNav=map.actionId==="program_prev"||map.actionId==="program_next",isPress=value>0,nowMs=performance.now();
    // Alguns bridges/controladores iOS enviam Note On/CC positivo repetido no mesmo
    // toque. Em LOOP isso virava ON->OFF instantâneo; nos botões PREV/NEXT faria pular duas páginas.
    if((isPad||isPageNav)&&isPress){
      const last=midiPadLastPress.get(key)||-Infinity;
      if(downMappedMidi.has(key)||nowMs-last<MIDI_PAD_DEBOUNCE_MS)return;
      midiPadLastPress.set(key,nowMs);
      downMappedMidi.set(key,{actionId:map.actionId,programIndex:state.currentProgram});
    }else if(type===0x90&&isPress&&!downMappedMidi.has(key)){downMappedMidi.set(key,{actionId:map.actionId,programIndex:state.currentProgram});}
    const held=downMappedMidi.get(key);
    performMappedAction(map.actionId,value,{source:"midi",programIndex:held?.programIndex,midiKind,controlKey:key});
    const isRelease=(type===0x80)||(type===0x90&&value===0)||(type===0xb0&&value===0);
    if(isRelease)downMappedMidi.delete(key);
  }
  function clearMappingsForAction(map,actionId){for(const key of Object.keys(map))if(map[key]?.actionId===actionId)delete map[key];}
  function targetById(id){return mappingTargets().find(t=>t.id===id);}
  function bindMappingModal(){
    document.querySelector("[data-mapping-backdrop]")?.addEventListener("pointerdown",e=>{if(e.target===e.currentTarget)closeModal();});document.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",closeModal));
    document.querySelectorAll("[data-learn-midi]").forEach(b=>b.addEventListener("click",async()=>{if(!midiAccess&&!(await enableMidi()))return;const t=targetById(b.dataset.learnMidi);midiLearnTarget=t;keyboardLearnTarget=null;renderMain();}));
    document.querySelectorAll("[data-learn-key]").forEach(b=>b.addEventListener("click",()=>{keyboardLearnTarget=targetById(b.dataset.learnKey);midiLearnTarget=null;renderMain();}));
    document.querySelectorAll("[data-clear-midi-action]").forEach(b=>b.addEventListener("click",()=>{clearMappingsForAction(midiMappings,b.dataset.clearMidiAction);saveStoredMap("nt-sampler-midi-map",midiMappings);renderMain();}));
    document.querySelectorAll("[data-clear-key-action]").forEach(b=>b.addEventListener("click",()=>{clearMappingsForAction(keyboardMappings,b.dataset.clearKeyAction);saveStoredMap("nt-sampler-keyboard-map",keyboardMappings);renderMain();}));
    document.querySelector("[data-clear-midi-all]")?.addEventListener("click",()=>{for(const k of Object.keys(midiMappings))delete midiMappings[k];saveStoredMap("nt-sampler-midi-map",midiMappings);renderMain();});
    document.querySelector("[data-clear-key-all]")?.addEventListener("click",()=>{for(const k of Object.keys(keyboardMappings))delete keyboardMappings[k];saveStoredMap("nt-sampler-keyboard-map",keyboardMappings);renderMain();});
  }
  function mappedParamSpec(actionId){const path=actionId.replace(/^fx_param_/,"");return fxMappingSpecs().find(s=>s.path===path);}
  function performMappedAction(actionId,value,meta={}){
    const press=value>0;
    if(actionId==="program_prev"&&press){stepProgram(-1);return;}
    if(actionId==="program_next"&&press){stepProgram(1);return;}
    if(actionId.startsWith("program_stop_")&&press){const i=Number(actionId.slice(13));if(Number.isInteger(i)&&i>=0&&i<PROGRAM_COUNT)stopProgram(i);return;}
    if(actionId.startsWith("program_mute_")&&press){const i=Number(actionId.slice(13));if(Number.isInteger(i)&&i>=0&&i<PROGRAM_COUNT)toggleProgramMute(i);return;}
    if(actionId.startsWith("program_solo_")&&press){const i=Number(actionId.slice(13));if(Number.isInteger(i)&&i>=0&&i<PROGRAM_COUNT)toggleProgramSolo(i);return;}
    if(actionId.startsWith("program_")&&press){const i=Number(actionId.slice(8));if(Number.isInteger(i)&&i>=0&&i<PROGRAM_COUNT)switchProgram(i);return;}
    if(actionId.startsWith("pad_")){const i=Number(actionId.slice(4)),programIndex=press?state.currentProgram:(Number.isInteger(meta.programIndex)?meta.programIndex:state.currentProgram),pad=state.programs[programIndex]?.pads[i];if(!pad)return;if(press){state.selectedPad=i;if(pad.source){const gateToken=pad.mode==="gate"?beginGatePress(programIndex,i):null;triggerPad(i,{programIndex,...(gateToken!==null?{gateToken}: {})});if(state.tab==="pad"||state.tab==="library"||state.tab==="fx")requestAnimationFrame(()=>refreshSidePanel());}else{state.tab="library";refreshSidePanel();}}else if(pad.mode==="gate")endGatePress(programIndex,i);return;}
    if(!press&&!["midi-param"].includes(meta.source))return;
    if(actionId==="transport"&&press){toggleTransport();return;}if(actionId==="stop_all"&&press){stopAll();return;}if(actionId==="tap"&&press){tapTempo();return;}
    if(actionId.startsWith("padfx_toggle_")&&press){const k=actionId.replace("padfx_toggle_","");const p=selectedPad();if(p?.fx?.[k]){pushHistory();p.fx[k].on=!p.fx[k].on;updatePadFxVoices(state.currentProgram,state.selectedPad);queueAutosave();if(state.tab==="fx")refreshSidePanel();}return;}
    if(actionId.startsWith("padfx_param_")){const path=actionId.replace("padfx_param_",""),spec=mappingTargets().find(t=>t.id===actionId)?.spec,p=selectedPad();if(!spec||!p)return;let v;if(meta.source==="midi")v=spec.min+clamp(value,0,1)*(spec.max-spec.min);else if(press){v=getPath(p.fx,path)+(meta.shift?-1:1)*(spec.keyStep||spec.step||1);}else return;v=clamp(v,spec.min,spec.max);if(spec.step)v=Math.round(v/spec.step)*spec.step;setPath(p.fx,path,v);updatePadFxVoices(state.currentProgram,state.selectedPad,path==="reverb.size");const label=document.querySelector(`[data-pad-fx-value="${path}"]`);if(label)label.textContent=formatPadFxValue(path,v);queueAutosave();return;}
    if(actionId.startsWith("fx_toggle_")&&press){const k=actionId.replace("fx_toggle_","");if(state.fx[k]){pushHistory();state.fx[k].on=!state.fx[k].on;updateAudioFx(k==="reverb");queueAutosave();if(state.tab==="io")refreshSidePanel();}return;}
    if(actionId.startsWith("fx_param_")){const spec=mappedParamSpec(actionId);if(!spec)return;let v;if(meta.source==="midi")v=spec.min+clamp(value,0,1)*(spec.max-spec.min);else if(press){const current=spec.path==="masterDb"?state.fx.masterDb:getPath(state.fx,spec.path);v=current+(meta.shift?-1:1)*(spec.keyStep||spec.step||1);}else return;v=clamp(v,spec.min,spec.max);if(spec.step)v=Math.round(v/spec.step)*spec.step;updateFxParam(spec.path,v);}
  }
  function bindMain(){
    document.querySelector("[data-transport]")?.addEventListener("click",toggleTransport);
    document.querySelector("[data-tap]")?.addEventListener("click",tapTempo);
    document.querySelector("[data-stop-all]")?.addEventListener("click",()=>stopAll());
    document.querySelector("[data-undo]")?.addEventListener("click",undoAction);
    document.querySelector("[data-redo]")?.addEventListener("click",redoAction);
    document.querySelector("[data-tempo]")?.addEventListener("change",e=>{const v=clamp(Number(e.target.value)||120,40,240);if(v!==state.tempo){pushHistory();setTempo(v);}});
    document.querySelector("[data-quantize]")?.addEventListener("change",e=>{if(state.quantize!==e.target.value){pushHistory();state.quantize=e.target.value;queueAutosave();}});
    const masterCompact=document.querySelector("[data-master-volume]");if(masterCompact)bindRangeHistory(masterCompact,()=>updateFxParam("masterDb",Number(masterCompact.value),masterCompact));
    document.querySelector("[data-program-prev]")?.addEventListener("click",()=>stepProgram(-1));
    document.querySelector("[data-program-next]")?.addEventListener("click",()=>stepProgram(1));
    document.querySelectorAll("[data-program]").forEach(b=>b.addEventListener("click",()=>switchProgram(Number(b.dataset.program))));
    document.querySelectorAll("[data-program-stop]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();stopProgram(Number(b.dataset.programStop));}));
    document.querySelectorAll("[data-program-mute]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();toggleProgramMute(Number(b.dataset.programMute));}));
    document.querySelectorAll("[data-program-solo]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();toggleProgramSolo(Number(b.dataset.programSolo));}));
    document.querySelectorAll("[data-program-volume]").forEach(input=>bindRangeHistory(input,()=>setProgramVolume(Number(input.dataset.programVolume),Number(input.value))));
    document.querySelector("[data-side-toggle]")?.addEventListener("click",toggleSidePanel);
    bindSideResizer();
    document.querySelectorAll("[data-pad]").forEach(p=>bindPadButton(p));
    document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{state.tab=b.dataset.tab;refreshSidePanel({preserveScroll:false});}));
    bindPatternBarControls();
    bindPanel(); updateUndoRedoButtons();
  }
  function bindPatternBarControls(){
    document.querySelector("[data-pattern-record]")?.addEventListener("click",()=>{const turningOn=!state.patternRecord;if(turningOn)pushHistory();state.patternRecord=turningOn;if(state.patternRecord&&!state.transport)startTransport();renderMain();});
    document.querySelector("[data-pattern-slot]")?.addEventListener("change",e=>selectPatternSlot(Number(e.target.value)));
    document.querySelector("[data-open-pattern]")?.addEventListener("click",()=>{state.modal="pattern";renderMain();});
    document.querySelector("[data-duplicate-pattern]")?.addEventListener("click",()=>duplicatePatternTo(Number(document.querySelector("[data-pattern-copy-target]")?.value)));
    document.querySelectorAll("[data-pattern-chip]").forEach(b=>b.addEventListener("click",()=>selectPatternSlot(Number(b.dataset.patternChip))));
    const patternName=document.querySelector("[data-pattern-name]");if(patternName){patternName.addEventListener("change",()=>renameCurrentPattern(patternName.value));patternName.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();patternName.blur();}});setTimeout(()=>document.querySelector(`.pattern-bank-item.active`)?.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"}),0);}
    document.querySelector("[data-clear-pattern]")?.addEventListener("click",clearPattern);
  }
  function bindSideResizer(){
    const handle=document.querySelector("[data-side-resizer]"),workspace=document.querySelector(".workspace");if(!handle||!workspace)return;
    const limits=()=>{const rect=workspace.getBoundingClientRect(),styles=getComputedStyle(workspace),gap=parseFloat(styles.columnGap)||0,program=document.querySelector(".program-strip")?.getBoundingClientRect().width||96,resizer=handle.getBoundingClientRect().width||7,min=Math.min(260,Math.max(190,Math.floor((rect.width-program-resizer-gap*3)/2))),max=Math.max(min,Math.floor((rect.width-program-resizer-gap*3)/2));return {min,max};};
    const constrain=()=>{const {min,max}=limits(),raw=parseFloat(getComputedStyle(workspace).getPropertyValue("--side-w"))||342,w=clamp(raw,min,max);workspace.style.setProperty("--side-w",`${Math.round(w)}px`);return w;};
    constrain();
    const move=e=>{const {min,max}=limits(),rect=workspace.getBoundingClientRect(),w=clamp(rect.right-e.clientX,min,max);workspace.style.setProperty("--side-w",`${Math.round(w)}px`);};
    const up=e=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);handle.classList.remove("dragging");const w=constrain();safeStorageSet("nt-sampler-side-width",String(Math.round(w)));try{handle.releasePointerCapture?.(e.pointerId)}catch{}};
    handle.addEventListener("pointerdown",e=>{e.preventDefault();handle.classList.add("dragging");handle.setPointerCapture?.(e.pointerId);document.addEventListener("pointermove",move);document.addEventListener("pointerup",up,{once:true});});
  }
  function bindLibraryResizer(){
    const handle=document.querySelector("[data-folder-resizer]"),browser=document.querySelector(".library-browser");if(!handle||!browser)return;
    const move=e=>{const rect=browser.getBoundingClientRect(),w=clamp(e.clientX-rect.left,120,Math.min(320,rect.width-180));browser.style.setProperty("--folder-w",`${Math.round(w)}px`);};
    const up=e=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);handle.classList.remove("dragging");const w=parseFloat(getComputedStyle(browser).getPropertyValue("--folder-w"))||168;safeStorageSet("nt-sampler-folder-width",String(Math.round(w)));try{handle.releasePointerCapture?.(e.pointerId)}catch{}};
    handle.addEventListener("pointerdown",e=>{e.preventDefault();handle.classList.add("dragging");handle.setPointerCapture?.(e.pointerId);document.addEventListener("pointermove",move);document.addEventListener("pointerup",up,{once:true});});
  }
  function bindPadButton(el){
    const index=Number(el.dataset.pad),programIndex=state.currentProgram;
    el.addEventListener("pointerdown",ev=>{
      ev.preventDefault();ensureAudioReady({gesture:true});el.setPointerCapture?.(ev.pointerId);state.selectedPad=index;
      document.querySelectorAll(".pad.selected").forEach(p=>p.classList.remove("selected"));el.classList.add("selected");
      const pad=state.programs[programIndex].pads[index];
      if(pad.source){const gateToken=pad.mode==="gate"?beginGatePress(programIndex,index):null;triggerPad(index,{programIndex,...(gateToken!==null?{gateToken}: {})});if(state.tab==="pad"||state.tab==="library"||state.tab==="fx")requestAnimationFrame(()=>refreshSidePanel());}
      else{state.tab="library";refreshSidePanel();}
    });
    const gateUp=()=>{const pad=state.programs[programIndex]?.pads[index];if(pad?.mode==="gate")endGatePress(programIndex,index);};
    el.addEventListener("pointerup",gateUp);el.addEventListener("pointercancel",gateUp);el.addEventListener("contextmenu",e=>e.preventDefault());
    el.addEventListener("dragover",e=>{const id=e.dataTransfer?.getData("text/nt-sample-id");if(id||e.dataTransfer?.types?.includes?.("text/nt-sample-id")){e.preventDefault();el.classList.add("drag-target");}});
    el.addEventListener("dragleave",()=>el.classList.remove("drag-target"));
    el.addEventListener("drop",async e=>{e.preventDefault();el.classList.remove("drag-target");const id=e.dataTransfer?.getData("text/nt-sample-id");const src=id?findLibrarySourceById(id):null;if(src)await assignSourceToPad(index,src);});
  }
  function refreshSidePanel({preserveScroll=true}={}){
    applyThemeState();const side=document.querySelector(".side-panel");if(!side)return;const oldBody=side.querySelector(".panel-body"),scroll=preserveScroll?(oldBody?.scrollTop||0):0;
    side.innerHTML=`<nav class="tabs">${tabsHtml()}</nav><div class="panel-body">${renderPanel()}</div>`;
    side.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{state.tab=b.dataset.tab;refreshSidePanel({preserveScroll:false});}));bindPanel();
    const body=side.querySelector(".panel-body");if(body&&preserveScroll)body.scrollTop=scroll;cacheUiRefs();applyThemeState();
  }
  function updatePadCard(programIndex,padIndex){
    if(programIndex!==state.currentProgram)return;const pad=state.programs[programIndex]?.pads[padIndex],el=document.querySelector(`[data-pad="${padIndex}"]`);if(!pad||!el)return;
    const mode=pad.mode==="oneshot"?"ONE SHOT":pad.mode.toUpperCase(),timing=pad.triggerMode==="free"?"FREE":"Q";
    const modeEl=el.querySelector(".pad-mode"),meta=el.querySelector(".pad-meta");if(modeEl)modeEl.textContent=pad.source?`${mode} · ${timing}`:"EMPTY";
    if(meta&&pad.source)meta.innerHTML=`<span>${pad.pitch>=0?"+":""}${pad.pitch.toFixed(0)} ST</span><span>${pad.gainDb>=0?"+":""}${pad.gainDb.toFixed(1)} dB</span>`;
  }
  function bindRangeHistory(input,handler){
    input.addEventListener("input",()=>{checkpointControl(input);handler();});
    ["change","pointerup","pointercancel","blur"].forEach(ev=>input.addEventListener(ev,()=>releaseControlCheckpoint(input)));
  }
  function moveFx(chain,key,dir){const i=chain.indexOf(key),j=i+dir;if(i<0||j<0||j>=chain.length)return;[chain[i],chain[j]]=[chain[j],chain[i]];}
  function refreshFxEditor(kind){
    const pad=kind==="pad"?selectedPad():null,chain=kind==="pad"?(pad?.fxChain||[]):(state.fxChain||[]),fx=kind==="pad"?(pad?.fx||defaultPadFx()):state.fx;
    const focus=focusedFx(kind,chain),itemSel=kind==="pad"?"[data-pad-fx-item]":"[data-fx-item]",hostSel=kind==="pad"?"[data-pad-fx-editor]":"[data-master-fx-editor]";
    document.querySelectorAll(itemSel).forEach(el=>{const key=kind==="pad"?el.dataset.padFxItem:el.dataset.fxItem,on=key===focus,enabled=!!fx?.[key]?.on;el.classList.toggle("selected",on);el.classList.toggle("on",enabled);el.setAttribute("aria-selected",on?"true":"false");const power=el.querySelector(kind==="pad"?"[data-pad-fx-power]":"[data-fx-power]");if(power){power.classList.toggle("on",enabled);power.title=enabled?"Bypass":"Enable";}});
    const host=document.querySelector(hostSel);if(!host)return;host.innerHTML=focus?(kind==="pad"?renderPadFxSettings(focus,fx):renderMasterFxSettings(focus,fx)):"";
    if(kind==="pad")bindPadFxSettingsControls();else bindMasterFxSettingsControls();
    syncVisualLearnTargets();
  }
  function bindFxRackControls(kind){
    const pad=kind==="pad"?selectedPad():null,chain=kind==="pad"?pad.fxChain:state.fxChain,fx=kind==="pad"?pad.fx:state.fx;
    const scope=document.querySelector(".panel-body")||document;
    const itemSel=kind==="pad"?"[data-pad-fx-item]":"[data-fx-item]";
    scope.querySelectorAll(itemSel).forEach(row=>row.addEventListener("click",e=>{if(e.target.closest(".fx-chain-actions"))return;const k=kind==="pad"?row.dataset.padFxItem:row.dataset.fxItem;if(!k)return;setFocusedFx(kind,k);refreshFxEditor(kind);}));
    scope.querySelectorAll(kind==="pad"?"[data-pad-fx-power]":"[data-fx-power]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();pushHistory();const k=kind==="pad"?b.dataset.padFxPower:b.dataset.fxPower;fx[k].on=!fx[k].on;setFocusedFx(kind,k);if(kind==="pad")updatePadFxVoices(state.currentProgram,state.selectedPad,k==="reverb");else updateAudioFx(k==="reverb");queueAutosave();refreshSidePanel();}));
    scope.querySelectorAll(kind==="pad"?"[data-pad-fx-move]":"[data-fx-move]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();pushHistory();const k=kind==="pad"?b.dataset.padFxMove:b.dataset.fxMove;moveFx(chain,k,Number(b.dataset.dir));setFocusedFx(kind,k);queueAutosave();refreshSidePanel();}));
    scope.querySelectorAll(kind==="pad"?"[data-pad-fx-remove]":"[data-fx-remove]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();pushHistory();const k=kind==="pad"?b.dataset.padFxRemove:b.dataset.fxRemove;const i=chain.indexOf(k);if(i>=0)chain.splice(i,1);fx[k].on=false;const next=chain[Math.min(i,chain.length-1)]||null;if(next)setFocusedFx(kind,next);if(kind==="pad")updatePadFxVoices(state.currentProgram,state.selectedPad);else updateAudioFx();queueAutosave();refreshSidePanel();}));
    scope.querySelector(kind==="pad"?"[data-pad-fx-add]":"[data-fx-add]")?.addEventListener("click",()=>{const sel=scope.querySelector(kind==="pad"?"[data-pad-fx-add-select]":"[data-fx-add-select]");const k=sel?.value;if(!k||chain.includes(k))return;pushHistory();chain.push(k);fx[k].on=true;setFocusedFx(kind,k);if(kind==="pad")updatePadFxVoices(state.currentProgram,state.selectedPad,k==="reverb");else updateAudioFx(k==="reverb");queueAutosave();refreshSidePanel();});
  }
  function bindPadFxSettingsControls(){
    document.querySelectorAll("[data-pad-fx-toggle]").forEach(b=>b.addEventListener("click",()=>{pushHistory();const p=selectedPad(),k=b.dataset.padFxToggle;p.fx[k].on=!p.fx[k].on;updatePadFxVoices(state.currentProgram,state.selectedPad);queueAutosave();refreshFxEditor("pad");}));
    document.querySelectorAll("[data-pad-fx-param]").forEach(input=>bindRangeHistory(input,()=>{const p=selectedPad(),path=input.dataset.padFxParam;setPath(p.fx,path,Number(input.value));updatePadFxVoices(state.currentProgram,state.selectedPad,path==="reverb.size");const v=document.querySelector(`[data-pad-fx-value="${path}"]`);if(v)v.textContent=formatPadFxValue(path,Number(input.value));queueAutosave();}));
    document.querySelectorAll("[data-pad-fx-number]").forEach(input=>input.addEventListener("change",()=>{pushHistory();const p=selectedPad(),path=input.dataset.padFxNumber;setPath(p.fx,path,Number(input.value));updatePadFxVoices(state.currentProgram,state.selectedPad,false);queueAutosave();refreshFxEditor("pad");}));
    document.querySelectorAll("[data-pad-fx-select]").forEach(sel=>sel.addEventListener("change",()=>{pushHistory();const p=selectedPad(),path=sel.dataset.padFxSelect,current=getPath(p.fx,path),value=typeof current==="number"?Number(sel.value):sel.value;setPath(p.fx,path,value);updatePadFxVoices(state.currentProgram,state.selectedPad,false);queueAutosave();refreshFxEditor("pad");}));
  }
  function bindPadFxControls(){bindFxRackControls("pad");bindPadFxSettingsControls();}
  function bindMasterFxSettingsControls(){
    document.querySelectorAll("[data-fx-toggle]").forEach(b=>b.addEventListener("click",()=>{pushHistory();const k=b.dataset.fxToggle;state.fx[k].on=!state.fx[k].on;if(k==="stutter"&&!state.fx.stutter.on&&masterGate){const t=getContext().currentTime;masterGate.gain.cancelScheduledValues(t);masterGate.gain.setTargetAtTime(1,t,.004);}updateAudioFx(k==="reverb");queueAutosave();refreshFxEditor("master");}));
    document.querySelectorAll("[data-fx-param]").forEach(input=>bindRangeHistory(input,()=>updateFxParam(input.dataset.fxParam,Number(input.value),input)));
    document.querySelectorAll("[data-fx-number]").forEach(input=>input.addEventListener("change",()=>{pushHistory();updateFxParam(input.dataset.fxNumber,Number(input.value),input);refreshFxEditor("master");}));
    document.querySelectorAll("[data-fx-select]").forEach(sel=>sel.addEventListener("change",()=>{pushHistory();const path=sel.dataset.fxSelect,current=getPath(state.fx,path),value=typeof current==="number"?Number(sel.value):sel.value;setPath(state.fx,path,value);updateAudioFx(false);queueAutosave();refreshFxEditor("master");}));
  }
  function bindMasterFxControls(){bindFxRackControls("master");bindMasterFxSettingsControls();}
  function clearTouchLibraryDrag(){
    if(!touchLibraryDrag)return;
    try{touchLibraryDrag.ghost?.remove();}catch{}
    document.querySelectorAll(".pad.drag-target").forEach(p=>p.classList.remove("drag-target"));
    touchLibraryDrag=null;
  }
  function touchDragPointTarget(x,y){
    const hit=document.elementFromPoint(x,y)?.closest?.("[data-pad]");
    document.querySelectorAll(".pad.drag-target").forEach(p=>p.classList.toggle("drag-target",p===hit));
    return hit;
  }
  function bindTouchSampleDrag(handle){
    const id=handle.dataset.touchDrag;if(!id)return;
    const start=(pointerId,x,y)=>{
      clearTouchLibraryDrag();const src=findLibrarySourceById(id);if(!src)return;
      const ghost=document.createElement("div");ghost.className="sample-drag-ghost";ghost.textContent=src.name;document.body.appendChild(ghost);
      touchLibraryDrag={id,src,pointerId,ghost,target:null};
      const moveGhost=(px,py)=>{ghost.style.transform=`translate3d(${Math.round(px+12)}px,${Math.round(py+12)}px,0)`;touchLibraryDrag.target=touchDragPointTarget(px,py);};
      moveGhost(x,y);
    };
    const move=(x,y)=>{if(!touchLibraryDrag||touchLibraryDrag.id!==id)return;touchLibraryDrag.ghost.style.transform=`translate3d(${Math.round(x+12)}px,${Math.round(y+12)}px,0)`;touchLibraryDrag.target=touchDragPointTarget(x,y);};
    const finish=async()=>{if(!touchLibraryDrag||touchLibraryDrag.id!==id)return;const drag=touchLibraryDrag,target=drag.target;clearTouchLibraryDrag();if(target){const pi=Number(target.dataset.pad);if(Number.isInteger(pi))await assignSourceToPad(pi,drag.src);}};
    if(window.PointerEvent){
      handle.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();handle.setPointerCapture?.(e.pointerId);start(e.pointerId,e.clientX,e.clientY);});
      handle.addEventListener("pointermove",e=>{if(touchLibraryDrag?.pointerId===e.pointerId){e.preventDefault();move(e.clientX,e.clientY);}});
      handle.addEventListener("pointerup",e=>{if(touchLibraryDrag?.pointerId===e.pointerId){e.preventDefault();finish();}});
      handle.addEventListener("pointercancel",clearTouchLibraryDrag);
    }else{
      handle.addEventListener("touchstart",e=>{const t=e.changedTouches?.[0];if(!t)return;e.preventDefault();start("touch",t.clientX,t.clientY);},{passive:false});
      handle.addEventListener("touchmove",e=>{const t=e.changedTouches?.[0];if(!t||!touchLibraryDrag)return;e.preventDefault();move(t.clientX,t.clientY);},{passive:false});
      handle.addEventListener("touchend",e=>{if(!touchLibraryDrag)return;e.preventDefault();finish();},{passive:false});
      handle.addEventListener("touchcancel",clearTouchLibraryDrag,{passive:true});
    }
  }

  function bindPanel(){
    if(state.tab==="library"){
      bindLibraryResizer();
      document.querySelector("[data-search]")?.addEventListener("input",e=>{state.search=e.target.value;renderLibraryOnly();});
      document.querySelector("[data-import-local]")?.addEventListener("click",()=>audioInput.click());document.querySelector("[data-import-folder]")?.addEventListener("click",()=>folderInput?.click());document.querySelector("[data-new-folder]")?.addEventListener("click",createVirtualFolder);
      document.querySelectorAll("[data-folder-toggle]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const f=b.dataset.folderToggle,list=new Set(state.collapsedFolders||[]);list.has(f)?list.delete(f):list.add(f);state.collapsedFolders=[...list];queueAutosave();renderLibraryOnly();}));
      document.querySelectorAll("[data-folder]").forEach(b=>{b.addEventListener("click",()=>{state.currentFolder=b.dataset.folder;renderLibraryOnly();});b.addEventListener("dragover",e=>{e.preventDefault();b.classList.add("drag-over")});b.addEventListener("dragleave",()=>b.classList.remove("drag-over"));b.addEventListener("drop",async e=>{e.preventDefault();b.classList.remove("drag-over");const id=e.dataTransfer?.getData("text/nt-sample-id");if(id)await moveAssetsToFolder([id],b.dataset.folder==="*"?"":b.dataset.folder);});});
      document.querySelectorAll("[data-drag-file]").forEach(row=>row.addEventListener("dragstart",e=>{e.dataTransfer?.setData("text/nt-sample-id",row.dataset.dragFile);if(e.dataTransfer)e.dataTransfer.effectAllowed="copy";}));
      document.querySelectorAll("[data-touch-drag]").forEach(bindTouchSampleDrag);
      document.querySelectorAll("[data-library-source]").forEach(b=>b.addEventListener("click",()=>{state.librarySource=b.dataset.librarySource;renderLibraryOnly();}));document.querySelector("[data-library-sort]")?.addEventListener("change",e=>{state.librarySort=e.target.value;renderLibraryOnly();});
      document.querySelectorAll("[data-select-file]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const id=b.dataset.selectFile;librarySelection.has(id)?librarySelection.delete(id):librarySelection.add(id);renderLibraryOnly();}));
      document.querySelector("[data-clear-selection]")?.addEventListener("click",()=>{librarySelection.clear();renderLibraryOnly();});document.querySelector("[data-move-selected]")?.addEventListener("click",()=>{if(librarySelection.size)openMoveDialog([...librarySelection]);});
      document.querySelectorAll("[data-move-file]").forEach(b=>b.addEventListener("click",()=>openMoveDialog([b.dataset.moveFile])));document.querySelectorAll("[data-preview-key]").forEach(b=>b.addEventListener("click",()=>{const src=findLibrarySource(b.dataset.previewKey);if(src)togglePreview(src,b)}));document.querySelectorAll("[data-assign-key]").forEach(b=>b.addEventListener("click",()=>{const src=findLibrarySource(b.dataset.assignKey);if(src)assignSourceToPad(state.selectedPad,src)}));
    } else if(state.tab==="pad"){
      document.querySelector("[data-clear-pad]")?.addEventListener("click",clearSelectedPad);document.querySelector("[data-open-editor]")?.addEventListener("click",()=>openEditor(state.selectedPad));
      document.querySelectorAll("[data-pad-mode]").forEach(b=>b.addEventListener("click",()=>{const p=selectedPad(),mode=b.dataset.padMode;if(p.mode===mode)return;pushHistory();p.mode=mode;if(mode==="loop"){const set=voiceSet(state.currentProgram,state.selectedPad);if(set&&[...set].some(v=>!v.ended))setLoopDesired(state.currentProgram,state.selectedPad,true);}else setLoopDesired(state.currentProgram,state.selectedPad,false);applyPadModeToVoices(state.currentProgram,state.selectedPad,mode);queueAutosave();updatePadCard(state.currentProgram,state.selectedPad);refreshSidePanel();}));document.querySelectorAll("[data-trigger-mode]").forEach(b=>b.addEventListener("click",()=>{const p=selectedPad(),mode=b.dataset.triggerMode;if(p.triggerMode===mode)return;pushHistory();p.triggerMode=mode;queueAutosave();updatePadCard(state.currentProgram,state.selectedPad);refreshSidePanel();}));document.querySelectorAll("[data-pad-param]").forEach(input=>bindRangeHistory(input,()=>updatePadParam(input.dataset.padParam,Number(input.value),input)));
      document.querySelector("[data-reverse]")?.addEventListener("click",()=>{pushHistory();selectedPad().reverse=!selectedPad().reverse;queueAutosave();refreshSidePanel();});document.querySelector("[data-pad-bpm]")?.addEventListener("change",e=>{pushHistory();selectedPad().originalBpm=e.target.value?clamp(Number(e.target.value),30,300):null;selectedPad().bpmConfidence=0;queueAutosave();refreshSidePanel();});document.querySelector("[data-detect-bpm]")?.addEventListener("click",async()=>{const p=selectedPad(),buf=await loadBuffer(p.source),d=detectSampleBpm(buf);pushHistory();p.originalBpm=d.bpm;p.bpmConfidence=d.confidence;p.tempoSync=!!d.bpm;queueAutosave();refreshSidePanel();notice(d.bpm?`BPM detectado: ${d.bpm}`:"Não consegui detectar BPM com confiança.",d.bpm?"ok":"warn",true);});document.querySelector("[data-tempo-sync]")?.addEventListener("click",()=>{pushHistory();selectedPad().tempoSync=!selectedPad().tempoSync;queueAutosave();refreshSidePanel();});
    } else if(state.tab==="fx"){
      bindPadFxControls();
    } else if(state.tab==="io"){
      document.querySelector("[data-rearm-audio]")?.addEventListener("click",async()=>{const ok=await ensureAudioReady({gesture:true,force:true});notice(ok?"Audio rearmado.":"O browser ainda mantém o áudio suspenso.",ok?"ok":"warn",true);});document.querySelector("[data-scan-audio]")?.addEventListener("click",()=>scanAudioDevices(true));document.querySelector("[data-audio-input]")?.addEventListener("change",e=>selectAudioInput(e.target.value));document.querySelector("[data-audio-output]")?.addEventListener("change",e=>selectAudioOutput(e.target.value));document.querySelector("[data-enable-midi]")?.addEventListener("click",enableMidi);document.querySelector("[data-midi-input]")?.addEventListener("change",e=>selectMidiInput(e.target.value));document.querySelector("[data-start-midi-learn]")?.addEventListener("click",()=>startVisualLearn("midi"));document.querySelector("[data-start-key-learn]")?.addEventListener("click",()=>startVisualLearn("keyboard"));document.querySelector("[data-open-mapping]")?.addEventListener("click",()=>{state.modal="mapping";renderMain();});document.querySelector("[data-theme-select]")?.addEventListener("change",e=>setTheme(e.currentTarget.value));bindMasterFxControls();
    } else {
      const name=document.querySelector("[data-project-name]");if(name){name.addEventListener("input",e=>{checkpointControl(name);state.projectName=e.target.value.slice(0,48);queueAutosave()});name.addEventListener("blur",()=>releaseControlCheckpoint(name));}document.querySelector("[data-save-project]")?.addEventListener("click",exportProject);document.querySelector("[data-open-project]")?.addEventListener("click",()=>projectInput.click());document.querySelector("[data-save-browser]")?.addEventListener("click",async()=>{clearTimeout(saveTimer);await idbPut("state",{key:"autosave",data:serializableState()});notice("Projeto salvo neste dispositivo.","ok",true)});document.querySelector("[data-new-project]")?.addEventListener("click",newProject);document.querySelector("[data-rec-master]")?.addEventListener("click",()=>mediaRecorder?.state==="recording"?stopMasterRecording():startMasterRecording());document.querySelector("[data-save-last-master]")?.addEventListener("click",()=>{if(pendingMasterExport){state.modal="masterExport";renderMain();}});
    }
  }
  function findLibrarySource(key){return [...state.localFiles,...state.serverFiles].find(f=>sourceKey(f)===key);}
  function findLibrarySourceById(id){return [...state.localFiles,...state.serverFiles].find(f=>String(f.id)===String(id));}
  function renderLibraryOnly(){const body=document.querySelector(".panel-body");if(!body)return;body.innerHTML=renderLibrary();bindPanel();}
  function renderPatternOnly(){const holder=document.querySelector("[data-pattern-steps]");if(!holder)return;holder.innerHTML=patternOverviewHtml(currentProgram().pattern);updateStepUi(currentUiStep);}
  function renderPatternGridOnly(){const p=currentProgram().pattern;if(state.modal==="pattern")document.querySelectorAll(".seq-cell").forEach(c=>c.classList.toggle("on",!!p.events[Number(c.dataset.seqStep)]?.includes(Number(c.dataset.seqPad))));renderPatternOnly();}
  function updatePadParam(key,value,input){const programIndex=state.currentProgram,padIndex=state.selectedPad,p=selectedPad();p[key]=value;if(key==="pitch"||key==="stretch")scheduleLoopRefresh(programIndex,padIndex);else applyPadParamToVoices(programIndex,padIndex,key,value);const label=document.querySelector(`[data-param-value="${key}"]`);if(label){const formats={gainDb:`${value>=0?"+":""}${value.toFixed(1)} dB`,pitch:`${value>=0?"+":""}${value.toFixed(0)} st`,pan:value.toFixed(2),cutoff:`${Math.round(value)} Hz`,resonance:value.toFixed(1),attack:`${Math.round(value*1000)} ms`,release:`${Math.round(value*1000)} ms`,reverbSend:`${Math.round(value*100)}%`,delaySend:`${Math.round(value*100)}%`,stretch:`${Math.round(value*100)}%`};label.textContent=formats[key]||value;}updatePadCard(programIndex,padIndex);queueAutosave();}
  function setPath(obj,path,value){const parts=path.split(".");let ref=obj;for(let i=0;i<parts.length-1;i++)ref=ref[parts[i]];ref[parts.at(-1)]=value;}
  function getPath(obj,path){return path.split(".").reduce((r,k)=>r?.[k],obj);}
  function fxMappingSpecs(){
    const specs=[
      ["masterDb","MASTER",-18,6,.5],["filter.cutoff","FILTER CUT",80,20000,10],["drive.amount","DRIVE",0,1,.01],["delay.mix","DELAY MIX",0,.75,.01],["delay.feedback","DELAY FEEDBACK",0,.82,.01],["reverb.mix","REVERB MIX",0,.75,.01],["reverb.size","REVERB SIZE",.25,4,.05],["stutter.depth","STUTTER DEPTH",0,1,.01],["scatter.mix","SCATTER MIX",0,1,.01],["scatter.rate","SCATTER RATE",1,8,1],["scatter.depth","SCATTER DEPTH",0,1,.01],["scatter.pattern","SCATTER PATTERN",0,7,1],["glitch.mix","GLITCH MIX",0,1,.01],["glitch.bits","GLITCH BITS",3,16,1],["glitch.hold","GLITCH HOLD",1,24,1],["glitch.dropout","GLITCH DROPOUT",0,.35,.01],
      ["oscBot.mix","OSC BOT MIX",0,1,.01],["oscBot.note","OSC BOT NOTE",24,84,1],["oscBot.tone","OSC BOT TONE",-50,50,1],["oscBot.attack","OSC BOT ATTACK",0,100,1],["oscBot.balance","OSC BOT BALANCE",0,1,.01],["oscBot.seqGate","OSC BOT SEQ GATE",.05,1,.01],
      ["patternSlicer.mix","PATTERN SLICER MIX",0,1,.01],["patternSlicer.pattern","PATTERN SLICER PATTERN",0,19,1],["patternSlicer.rate","PATTERN SLICER RATE",1,16,1],["patternSlicer.duty","PATTERN SLICER DUTY",.05,.95,.01],["patternSlicer.depth","PATTERN SLICER DEPTH",0,1,.01],
      ["stepSlicer.mix","SAMPLE SLICER MIX",0,1,.01],["stepSlicer.rate","SAMPLE SLICER RATE",1,16,1],["stepSlicer.depth","SAMPLE SLICER DEPTH",0,1,.01],
      ["eq.low","EQ LOW",-12,12,.5],["eq.lowMid","EQ LOW MID",-12,12,.5],["eq.highMid","EQ HIGH MID",-12,12,.5],["eq.high","EQ HIGH",-12,12,.5],
      ["compressor.threshold","COMP THRESHOLD",-48,0,.5],["compressor.ratio","COMP RATIO",1,20,.5],["compressor.attack","COMP ATTACK",.001,.2,.001],["compressor.release","COMP RELEASE",.03,1,.01],["compressor.makeup","COMP MAKEUP",-6,12,.5],["limiter.ceiling","LIMITER CEILING",-12,0,.1],["limiter.release","LIMITER RELEASE",.02,.5,.01]
    ].map(([path,label,min,max,step])=>({path,label,min,max,step,keyStep:step}));
    for(let i=0;i<16;i++){specs.push({path:`stepSlicer.step${i}`,label:`SAMPLE SLICER ${i+1}`,min:0,max:1,step:.01,keyStep:.05});specs.push({path:`oscBot.step${i}`,label:`OSC SEQ ${i+1}`,min:-24,max:24,step:1,keyStep:1});}
    return specs;
  }
  function formatFxValue(path,value){
    if(path==="masterDb")return `${value>=0?"+":""}${Number(value).toFixed(1)} dB`;
    if(path.includes("cutoff"))return `${Math.round(value)} Hz`;
    if(path.includes("reverb.size"))return `${Number(value).toFixed(2)} s`;
    if(path.startsWith("eq.")||path.includes("threshold")||path.includes("ceiling")||path.includes("makeup"))return `${value>=0?"+":""}${Number(value).toFixed(1)} dB`;
    if(path==="compressor.ratio")return `${Number(value).toFixed(1)}:1`;
    if(path==="compressor.attack"||path==="compressor.release"||path==="limiter.release")return `${Math.round(Number(value)*1000)} ms`;
    if(path.includes("note")||path.includes("tone")||path.includes("pattern")||path.includes("rate")||/step\d+$/.test(path))return `${Math.round(value*100)/100}`;
    if(path.includes("attack")&&path.startsWith("oscBot"))return `${Math.round(value)}%`;
    return `${Math.round(value*100)}%`;
  }
  function updateFxParam(path,value,input){if(path==="masterDb")state.fx.masterDb=value;else setPath(state.fx,path,value);updateAudioFx(path==="reverb.size");const label=document.querySelector(`[data-fx-value="${path}"]`);if(label)label.textContent=formatFxValue(path,value);queueAutosave();}
  function stepProgram(delta){const next=(state.currentProgram+Number(delta||0)+PROGRAM_COUNT)%PROGRAM_COUNT;switchProgram(next);}
  function switchProgram(index){
    index=clamp(Math.round(Number(index)||0),0,PROGRAM_COUNT-1);
    // currentProgram é somente a seleção da interface. Trocar de tela nunca para, reinicia
    // ou desconecta vozes/racks de outro programa. Em PLAY, o novo programa apenas entra
    // como mais uma lane no transporte global já existente.
    if(index===state.currentProgram){
      if(state.transport&&armTransportProgram(index)){syncProgramStripUi();notice(`PROGRAM ${String(index+1).padStart(2,"0")} entrou no transporte global.`,"ok",true);}
      return;
    }
    state.currentProgram=index;
    if(state.transport)armTransportProgram(index);
    state.selectedPad=clamp(state.selectedPad,0,PAD_COUNT-1);state.patternRecord=false;activePattern(currentProgram());
    queueAutosave();renderProgramSelection();preloadProgram();
  }
  function setTempo(v){const bpm=clamp(Number(v)||120,40,240);state.tempo=bpm;updateAudioFx();for(const rack of padFxRacks.values())updatePadRack(rack.programIndex,rack.padIndex,false);for(const [key,set] of padVoices){const [pr,pi]=key.split(":").map(Number),pad=state.programs[pr]?.pads[pi];if(pad?.tempoSync&&pad.mode==="loop")scheduleLoopRefresh(pr,pi);}if(state.transport){stopTransport({preservePrograms:true});startTransport({preservePrograms:true});}queueAutosave();const tempo=document.querySelector("[data-tempo]");if(tempo&&document.activeElement!==tempo)tempo.value=Math.round(bpm);}
  function tapTempo(){const now=performance.now();tapTimes.push(now);tapTimes=tapTimes.filter(t=>now-t<2200).slice(-5);if(tapTimes.length>=2){const diffs=tapTimes.slice(1).map((t,i)=>t-tapTimes[i]),bpm=60000/(diffs.reduce((a,b)=>a+b,0)/diffs.length);if(Math.abs(bpm-state.tempo)>.05){pushHistory();setTempo(bpm);}}}
  function latencyText(){if(!audioCtx)return "LATENCY --";const base=Number(audioCtx.baseLatency)||0;const out=Number(audioCtx.outputLatency)||0;return `LAT ${(base+out)*1000?((base+out)*1000).toFixed(1):"?"} ms · ${audioCtx.sampleRate/1000}k`;}
  function updateTransportButtons(){const buttons=document.querySelectorAll("[data-transport],[data-pattern-play]");buttons.forEach(b=>{b.classList.toggle("running",state.transport);const glyph=b.querySelector(".transport-glyph");if(glyph){glyph.classList.toggle("pause",state.transport);glyph.classList.toggle("play",!state.transport);}const label=b.querySelector("small");if(label)label.textContent=state.transport?"PAUSE":"PLAY";});}

  async function openEditor(index){const p=currentProgram().pads[index];if(!p.source)return;try{const buffer=await loadBuffer(p.source),start=clamp(p.start||0,0,buffer.duration-.001),end=clamp(p.end||buffer.duration,start+.001,buffer.duration);state.editor={padIndex:index,buffer,start,end,zoom:1,center:(start+end)/2,snap:true,playhead:start,audition:null,auditionLoop:false,auditionStartedAt:0,auditionRate:1,drag:null};renderMain();}catch{notice("Não consegui abrir o editor.","warn",true)}}
  function editorView(){const e=state.editor,d=e.buffer.duration,visible=d/e.zoom;let start=e.center-visible/2;start=clamp(start,0,Math.max(0,d-visible));return {start,duration:Math.min(visible,d),end:Math.min(d,start+visible)};}
  function bindEditor(){
    drawEditorWave();updateRuler();const ed=document.querySelector("[data-wave-editor]");
    document.querySelectorAll("[data-close-editor]").forEach(b=>b.addEventListener("click",closeEditor));
    document.querySelector("[data-editor-backdrop]")?.addEventListener("pointerdown",e=>{if(e.target===e.currentTarget)closeEditor()});
    document.querySelectorAll("[data-handle]").forEach(h=>{h.addEventListener("pointerdown",e=>editorDragStart(e,h.dataset.handle));h.addEventListener("pointermove",editorDragMove);h.addEventListener("pointerup",editorDragEnd);h.addEventListener("pointercancel",editorDragEnd)});
    document.querySelector("[data-time-in]")?.addEventListener("change",e=>setEditorPoint("in",Number(e.target.value)/1000));document.querySelector("[data-time-out]")?.addEventListener("change",e=>setEditorPoint("out",Number(e.target.value)/1000));
    document.querySelectorAll("[data-nudge]").forEach(b=>b.addEventListener("click",ev=>{const [which,dir]=b.dataset.nudge.split(":");nudgeEditor(which,Number(dir)*(ev.shiftKey?10:1)/1000)}));
    document.querySelector("[data-snap]")?.addEventListener("click",()=>{state.editor.snap=!state.editor.snap;renderMain()});
    document.querySelector("[data-editor-zoom]")?.addEventListener("input",e=>{const edState=state.editor;edState.zoom=Number(e.target.value);edState.center=clamp(edState.playhead,0,edState.buffer.duration);renderEditorLive();});
    document.querySelector("[data-editor-center]")?.addEventListener("input",e=>{state.editor.center=Number(e.target.value);renderEditorLive()});
    document.querySelector("[data-audition-editor]")?.addEventListener("click",()=>auditionEditor());
    document.querySelector("[data-audition-loop]")?.addEventListener("click",()=>{const e=state.editor;if(!e)return;const wasPlaying=!!e.audition;if(wasPlaying)stopEditorAudition();e.auditionLoop=!e.auditionLoop;updateEditorAuditionUi();if(wasPlaying)auditionEditor(true);});
    document.querySelector("[data-export-trim]")?.addEventListener("click",exportTrimmedSample);
    document.querySelector("[data-apply-editor]")?.addEventListener("click",applyEditor);
    ed?.addEventListener("pointerdown",e=>{if(e.target===ed||e.target.tagName==="CANVAS"){const rect=ed.getBoundingClientRect(),view=editorView(),time=view.start+clamp((e.clientX-rect.left)/rect.width,0,1)*view.duration;state.editor.playhead=time;if(state.editor.zoom>1)state.editor.center=time;renderEditorLive();}});
  }
  function editorDragStart(e,which){e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);state.editor.drag=which;editorDragMove(e);}
  function editorDragMove(e){if(!state.editor?.drag)return;const el=document.querySelector("[data-wave-editor]"),rect=el.getBoundingClientRect(),view=editorView(),t=view.start+clamp((e.clientX-rect.left)/rect.width,0,1)*view.duration;setEditorPoint(state.editor.drag,t,true);}
  function editorDragEnd(){if(state.editor){const was=state.editor.drag;state.editor.drag=null;if(was&&state.editor.auditionLoop&&state.editor.audition)auditionEditor(true);}}
  function snapZero(buffer,time){const data=buffer.getChannelData(0),idx=clamp(Math.floor(time*buffer.sampleRate),1,data.length-2),radius=Math.min(2048,Math.floor(buffer.sampleRate*.03));let best=idx,bestAbs=Math.abs(data[idx]);for(let i=Math.max(1,idx-radius);i<Math.min(data.length-1,idx+radius);i++){if((data[i-1]<=0&&data[i]>=0)||(data[i-1]>=0&&data[i]<=0))return i/buffer.sampleRate;const a=Math.abs(data[i]);if(a<bestAbs){bestAbs=a;best=i}}return best/buffer.sampleRate;}
  function syncEditorAuditionLoop(){const e=state.editor;if(!e?.audition||!e.auditionLoop)return;auditionEditor(true);}
  function setEditorPoint(which,time,live=false){const e=state.editor;if(!e)return;time=clamp(time,0,e.buffer.duration);if(e.snap)time=snapZero(e.buffer,time);if(which==="in")e.start=Math.min(time,e.end-.001);else e.end=Math.max(time,e.start+.001);e.center=clamp(e.center,0,e.buffer.duration);if(!live)syncEditorAuditionLoop();renderEditorLive();}
  function nudgeEditor(which,delta){const e=state.editor;if(which==="in")setEditorPoint("in",e.start+delta);else setEditorPoint("out",e.end+delta);}
  function renderEditorLive(){const e=state.editor;if(!e)return;const view=editorView(),left=(e.start-view.start)/view.duration*100,right=100-(e.end-view.start)/view.duration*100,ph=(e.playhead-view.start)/view.duration*100;const inH=document.querySelector('[data-handle="in"]'),outH=document.querySelector('[data-handle="out"]');if(inH)inH.style.left=`${clamp(left,0,100)}%`;if(outH)outH.style.left=`${clamp(100-right,0,100)}%`;const sel=document.querySelector("[data-wave-selection]");if(sel){sel.style.left=`${clamp(left,0,100)}%`;sel.style.right=`${clamp(right,0,100)}%`;}const ml=document.querySelector("[data-mask-left]"),mr=document.querySelector("[data-mask-right]");if(ml)ml.style.width=`${clamp(left,0,100)}%`;if(mr)mr.style.width=`${clamp(right,0,100)}%`;const play=document.querySelector("[data-editor-playhead]");if(play)play.style.left=`${clamp(ph,0,100)}%`;const ti=document.querySelector("[data-time-in]"),to=document.querySelector("[data-time-out]"),center=document.querySelector("[data-editor-center]");if(ti)ti.value=Math.round(e.start*1000);if(to)to.value=Math.round(e.end*1000);if(center)center.value=e.center;drawEditorWave();updateRuler();}
  function drawEditorWave(){const canvas=document.querySelector("[data-editor-wave]"),e=state.editor;if(!canvas||!e)return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(400,Math.floor(rect.width*dpr)),h=Math.max(120,Math.floor(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const g=canvas.getContext("2d"),view=editorView(),data=e.buffer.getChannelData(0),startSample=Math.floor(view.start*e.buffer.sampleRate),endSample=Math.min(data.length,Math.ceil(view.end*e.buffer.sampleRate)),span=endSample-startSample,step=Math.max(1,Math.floor(span/w));g.clearRect(0,0,w,h);g.fillStyle="#030405";g.fillRect(0,0,w,h);g.strokeStyle="rgba(101,236,255,.78)";g.lineWidth=Math.max(1,dpr);g.beginPath();for(let x=0;x<w;x++){let min=1,max=-1,base=startSample+x*step;for(let j=0;j<step;j++){const v=data[base+j]||0;if(v<min)min=v;if(v>max)max=v}g.moveTo(x,(1+min)*h*.5);g.lineTo(x,(1+max)*h*.5)}g.stroke();}
  function updateRuler(){const ruler=document.querySelector("[data-wave-ruler]"),grid=document.querySelector("[data-wave-grid]");if(!ruler||!state.editor)return;const view=editorView();ruler.innerHTML=Array.from({length:6},(_,i)=>{const pct=i*20,t=view.start+view.duration*(i/5);return `<span style="left:${pct}%">${fmtShort(t)}</span>`}).join("");if(grid){const beat=beatSeconds(),first=Math.floor(view.start/beat)*beat,lines=[];for(let t=first;t<=view.end+beat;t+=beat){if(t<view.start-.0001)continue;const pct=(t-view.start)/view.duration*100;lines.push(`<i style="left:${pct}%"><b>${Math.floor(t/beat)+1}</b></i>`);}grid.innerHTML=lines.join("");}}
  function updateEditorAuditionUi(){const e=state.editor;if(!e)return;const a=document.querySelector("[data-audition-editor]"),l=document.querySelector("[data-audition-loop]");if(a){a.textContent=e.audition?"■ STOP":"▶ AUDITION";a.classList.toggle("on",!!e.audition);}if(l){l.textContent=`LOOP ${e.auditionLoop?"ON":"OFF"}`;l.classList.toggle("on",e.auditionLoop);}}
  function stopEditorAudition(){const e=state.editor;if(!e?.audition)return;try{e.audition.onended=null;e.audition.stop()}catch{}e.audition=null;e.playhead=e.start;syncMasterPerformanceActivity();updateEditorAuditionUi();}
  function auditionEditor(restart=false){const e=state.editor;if(!e)return;if(e.audition&&!restart){stopEditorAudition();return;}if(e.audition&&restart)stopEditorAudition();const ctx=getContext(),p=currentProgram().pads[e.padIndex],temp={...p,start:e.start,end:e.end};transformedPadBuffer(temp).then(buffer=>{if(!state.editor)return;const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buffer;src.playbackRate.value=1;src.loop=e.auditionLoop;src.loopStart=0;src.loopEnd=buffer.duration;gain.gain.value=dbToGain(p.gainDb);src.connect(gain).connect(masterInput);e.audition=src;syncMasterPerformanceActivity();e.auditionStartedAt=ctx.currentTime;e.auditionRate=(e.end-e.start)/buffer.duration;e.auditionBufferDuration=buffer.duration;e.auditionReverse=false;e.playhead=e.start;src.onended=()=>{if(state.editor?.audition===src){state.editor.audition=null;state.editor.playhead=e.start;updateEditorAuditionUi();}};src.start();updateEditorAuditionUi();});}
  function applyEditor(){const e=state.editor;if(!e)return;const p=currentProgram().pads[e.padIndex];pushHistory();p.start=e.start;p.end=e.end;closeEditor();queueAutosave();}
  function closeEditor(){if(state.editor?.audition)try{state.editor.audition.onended=null;state.editor.audition.stop()}catch{}state.editor=null;renderMain();}

  async function exportProject(){notice("Montando projeto portátil...");try{const data=serializableState(),ids=new Set(Object.keys(state.assetFolders||{}));data.programs.forEach(pr=>pr.pads.forEach(p=>{if(p.source?.kind==="local")ids.add(p.source.id)}));const embeddedAssets={};for(const id of ids){const rec=await idbGet("assets",id);if(rec?.blob)embeddedAssets[id]={name:rec.name,size:rec.size,type:rec.type,folder:state.assetFolders?.[id]??rec.folder??"",data:await blobToDataUrl(rec.blob)};}const payload={format:"NT_SAMPLER_PROJECT",version:VERSION,createdAt:new Date().toISOString(),data,embeddedAssets};downloadBlob(new Blob([JSON.stringify(payload)],{type:"application/json"}),`${safeName(state.projectName)}.ntsampler`);notice("Projeto salvo com samples locais incorporados.","ok",true);}catch(err){console.error(err);notice("Falha ao salvar projeto.","warn",true)}}
  function blobToDataUrl(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)});}
  function dataUrlToBlob(dataUrl){const [head,b64]=dataUrl.split(","),type=(head.match(/data:(.*?);/)||[])[1]||"application/octet-stream",bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type});}
  async function importProjectFile(file){notice("Abrindo projeto...");try{const payload=JSON.parse(await file.text());const data=payload.format==="NT_SAMPLER_PROJECT"?payload.data:payload;if(!data?.programs)throw new Error("invalid");if(payload.embeddedAssets){for(const [id,a] of Object.entries(payload.embeddedAssets)){const blob=dataUrlToBlob(a.data);await idbPut("assets",{id,name:a.name,size:a.size||blob.size,type:a.type||blob.type,folder:normalizeFolder(a.folder||payload.data?.assetFolders?.[id]||""),blob,createdAt:Date.now()});localBlobCache.set(id,blob);}}panic();stopTransport();disposeAllPadRacks();applySaved(data);resetHistory();await loadLocalLibrary();updateAudioFx(true);queueAutosave();state.tab="library";renderMain();preloadProgram();notice("Projeto aberto.","ok",true);}catch(err){console.error(err);notice("Arquivo de projeto inválido.","warn",true)}}
  function safeName(name){return String(name||"nt-sampler-project").trim().replace(/[^a-z0-9-_]+/gi,"-").replace(/^-+|-+$/g,"")||"nt-sampler-project";}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function newProject(){pushHistory();panic();stopTransport();disposeAllPadRacks();state={...makeState(),started:true,serverFiles:state.serverFiles,localFiles:state.localFiles};for(let i=0;i<PROGRAM_COUNT;i++)if(programBuses.has(i)){applyProgramMute(i,true);applyProgramVolume(i,true);}updateAudioFx(true);syncMasterPerformanceActivity(true);queueAutosave();renderMain();}

  function startMasterRecording(){const ctx=getContext();if(typeof MediaRecorder==="undefined"){notice("MediaRecorder não disponível.","warn",true);return;}recordDestination=ctx.createMediaStreamDestination();masterGain.connect(recordDestination);const types=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t));try{mediaRecorder=new MediaRecorder(recordDestination.stream,mime?{mimeType:mime,audioBitsPerSecond:256000}:undefined);}catch{mediaRecorder=new MediaRecorder(recordDestination.stream)}recordChunks=[];mediaRecorder.ondataavailable=e=>{if(e.data.size)recordChunks.push(e.data)};mediaRecorder.onstop=finishMasterRecording;recordingStartedAt=performance.now();mediaRecorder.start(500);renderMain();notice("Gravando master...","warn");}
  function stopMasterRecording(){if(mediaRecorder?.state==="recording")mediaRecorder.stop();}
  async function finishMasterRecording(){
    try{masterGain.disconnect(recordDestination)}catch{}
    recordDestination?.stream.getTracks().forEach(t=>t.stop());
    const recorder=mediaRecorder,blob=new Blob(recordChunks,{type:recorder?.mimeType||"audio/webm"});
    let out=blob,ext=blob.type.includes("mp4")?"m4a":"webm";
    try{const decoded=await getContext().decodeAudioData(await blob.arrayBuffer());out=audioBufferToWav(decoded);ext="wav"}catch{}
    const name=`${safeName(state.projectName)}-rec.${ext}`,seconds=((performance.now()-recordingStartedAt)/1000).toFixed(1);
    mediaRecorder=null;recordDestination=null;recordChunks=[];
    if(isIOSLike()){pendingMasterExport={blob:out,name,seconds};state.modal="masterExport";renderMain();notice(`Master pronto · ${seconds}s · toque SALVAR / SHARE.`,"ok",true);return;}
    downloadBlob(out,name);pendingMasterExport=null;renderMain();notice(`Master exportado · ${seconds}s`,"ok",true);
  }
  function renderMasterExportModal(){const exp=pendingMasterExport;if(!exp)return "";const size=fmtBytes(exp.blob?.size||0);return `<div class="editor-backdrop master-export-backdrop" data-master-export-backdrop><section class="master-export-modal"><header><div><small>MASTER RECORDING</small><h2>GRAVAÇÃO PRONTA</h2></div><button class="close-editor" data-close-master-export>×</button></header><div class="master-export-file"><b>${escapeHtml(exp.name)}</b><span>${escapeHtml(exp.seconds||"")}s${size?` · ${size}`:""}</span></div><p>No iPad/Web MIDI Browser o download automático não abre a janela de arquivos. Use um botão abaixo: SHARE abre a folha do iPadOS quando disponível; OPEN AUDIO abre o arquivo para então usar Compartilhar → Salvar em Arquivos.</p><div class="master-export-actions"><button class="project-btn primary" data-master-export-share>SHARE / SAVE TO FILES</button><button class="project-btn" data-master-export-open>OPEN AUDIO</button><button class="project-btn" data-master-export-download>DOWNLOAD</button></div></section></div>`;}
  async function sharePendingMasterExport(){const exp=pendingMasterExport;if(!exp)return false;let file=null;try{file=new File([exp.blob],exp.name,{type:exp.blob.type||"audio/wav"});}catch{}
    if(file&&typeof navigator.share==="function"){try{const payload={files:[file],title:exp.name};if(typeof navigator.canShare!=="function"||navigator.canShare(payload)){await navigator.share(payload);return true;}}catch(err){if(err?.name==="AbortError")return false;console.warn("Share master",err);}}
    return openPendingMasterExport();
  }
  function openPendingMasterExport(){const exp=pendingMasterExport;if(!exp)return false;const url=URL.createObjectURL(exp.blob),win=window.open(url,"_blank");if(win){setTimeout(()=>URL.revokeObjectURL(url),120000);return true;}URL.revokeObjectURL(url);downloadBlob(exp.blob,exp.name);return true;}
  function bindMasterExportModal(){document.querySelector("[data-close-master-export]")?.addEventListener("click",()=>{state.modal=null;renderMain();});document.querySelector("[data-master-export-backdrop]")?.addEventListener("pointerdown",e=>{if(e.target===e.currentTarget){state.modal=null;renderMain();}});document.querySelector("[data-master-export-share]")?.addEventListener("click",sharePendingMasterExport);document.querySelector("[data-master-export-open]")?.addEventListener("click",openPendingMasterExport);document.querySelector("[data-master-export-download]")?.addEventListener("click",()=>{if(pendingMasterExport)downloadBlob(pendingMasterExport.blob,pendingMasterExport.name);});}
  function audioBufferToWav(buffer){const channels=Math.min(2,buffer.numberOfChannels),frames=buffer.length,bytesPerFrame=channels*2,ab=new ArrayBuffer(44+frames*bytesPerFrame),v=new DataView(ab);const text=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};text(0,"RIFF");v.setUint32(4,36+frames*bytesPerFrame,true);text(8,"WAVE");text(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*bytesPerFrame,true);v.setUint16(32,bytesPerFrame,true);v.setUint16(34,16,true);text(36,"data");v.setUint32(40,frames*bytesPerFrame,true);let off=44;for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){const x=clamp(buffer.getChannelData(c)[i],-1,1);v.setInt16(off,x<0?x*32768:x*32767,true);off+=2}return new Blob([ab],{type:"audio/wav"});}

  function trimmedAudioBuffer(){const e=state.editor;if(!e)return null;const startFrame=clamp(Math.floor(e.start*e.buffer.sampleRate),0,e.buffer.length-1),endFrame=clamp(Math.ceil(e.end*e.buffer.sampleRate),startFrame+1,e.buffer.length),frames=endFrame-startFrame,ctx=getContext(),out=ctx.createBuffer(e.buffer.numberOfChannels,frames,e.buffer.sampleRate);for(let c=0;c<e.buffer.numberOfChannels;c++)out.getChannelData(c).set(e.buffer.getChannelData(c).subarray(startFrame,endFrame));return out;}
  function exportTrimmedSample(){const e=state.editor;if(!e)return;const out=trimmedAudioBuffer();if(!out)return;const pad=currentProgram().pads[e.padIndex],base=(pad.source?.name||`pad-${e.padIndex+1}`).replace(/\.[^.]+$/,"");downloadBlob(audioBufferToWav(out),`${safeName(base)}-trim.wav`);notice("Trecho trimado exportado em WAV.","ok",true);}

  async function fetchServerFiles(){try{let r=await fetch(`api.php?t=${Date.now()}`,{cache:"no-store"});if(!r.ok)throw 0;const d=await r.json();state.serverFiles=(d.files||[]).map(f=>({kind:"server",id:f.id||f.url,name:f.name,url:f.url,size:f.size||0,type:f.type||"",folder:normalizeFolder(f.folder||"")})).filter(isSupportedAudio);}catch{try{const r=await fetch(`samples/manifest.json?t=${Date.now()}`,{cache:"no-store"}),d=await r.json();state.serverFiles=(d.files||[]).map(f=>({kind:"server",id:f.id||f.url,name:f.name,url:f.url,size:f.size||0,type:f.type||"",folder:normalizeFolder(f.folder||"")})).filter(isSupportedAudio);}catch{state.serverFiles=[]}}}
  async function loadLocalLibrary(){try{const all=await idbGetAll("assets");state.localFiles=all.filter(isSupportedAudio).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(a=>{const folder=normalizeFolder(state.assetFolders?.[a.id]??a.folder??"");if(folder)registerFolder(folder);return {kind:"local",id:a.id,name:a.name,size:a.size||a.blob?.size||0,type:a.type||a.blob?.type||"",folder,createdAt:a.createdAt||0};});}catch{state.localFiles=[]}}
  async function preloadProgram(){const programIndex=state.currentProgram,pads=state.programs[programIndex].pads.map((p,i)=>({p,i})).filter(x=>x.p.source);for(const x of pads){if(programIndex!==state.currentProgram)return;try{await loadBuffer(x.p.source);ensurePadRack(programIndex,x.i);await transformedPadBuffer(x.p);}catch{}await new Promise(r=>setTimeout(r,2));}}
  async function startApp(){setTheme(state.theme);getContext();const midiInit=enableMidi({silent:true});const audioOk=await ensureAudioReady({gesture:true,force:true});masterClockOrigin=audioCtx.currentTime+.08;state.started=true;resetHistory();await ensureWorkletFx();await applySavedAudioOutput();updateAudioFx(true);renderMain();preloadProgram();scanAudioDevices(false);midiInit.then(()=>{preferPlaybackAudioSession();ensureAudioReady({force:true});}).catch(()=>{});notice(audioOk?"Audio engine pronto.":"Audio iniciado, mas o browser ainda reporta estado suspenso.",audioOk?"ok":"warn",true);}

  function cacheUiRefs(){
    uiRefs.masterMeter=document.querySelector("[data-meter]");uiRefs.position=document.querySelector("[data-position]");uiRefs.latency=[...document.querySelectorAll("[data-latency]")];
    uiRefs.padProgress=Array.from({length:PAD_COUNT},(_,i)=>document.querySelector(`[data-pad="${i}"] .pad-progress`));
    uiRefs.programMeters=Array.from({length:PROGRAM_COUNT},(_,i)=>document.querySelector(`[data-program-vu="${i}"]`));
  }
  function updateLatencyUi(){const text=latencyText();for(const el of uiRefs.latency)if(el)el.textContent=text;}

  function animationLoop(ts=0){
    if(audioCtx){
      if(previewMeta&&ts-lastUiVisualFrame>=50){state.previewProgress=clamp((audioCtx.currentTime-previewMeta.start)/previewMeta.duration,0,1);document.querySelectorAll(".file-item.previewing .preview-line").forEach(e=>e.style.width=`${state.previewProgress*100}%`)}
      while(scheduledUiSteps.length && scheduledUiSteps[0].time<=audioCtx.currentTime+.002){currentUiStep=scheduledUiSteps.shift().step;updateStepUi(currentUiStep)}
      if(ts-lastUiVisualFrame>=50){lastUiVisualFrame=ts;updatePadProgress();updateEditorPlayhead();}
      if(ts-lastUiMeterFrame>=66){lastUiMeterFrame=ts;updateMeter();}
      if(ts-lastUiReadoutFrame>=125){lastUiReadoutFrame=ts;updatePositionReadout();}
    }
    requestAnimationFrame(animationLoop);
  }
  function updateStepUi(globalStep){const total=Math.max(1,currentProgram().pattern.events.length),step=((Number(globalStep)||0)%total+total)%total,beat=Math.floor(step/4);document.querySelectorAll(".step.current,.seq-tick.current,.seq-cell.current").forEach(e=>e.classList.remove("current"));document.querySelector(`[data-overview-beat="${beat}"]`)?.classList.add("current");document.querySelector(`[data-seq-head="${step}"]`)?.classList.add("current");document.querySelectorAll(`[data-seq-step="${step}"]`).forEach(e=>e.classList.add("current"));}
  function updatePadProgress(){for(const set of padVoices.values()){const voice=[...set].at(-1);if(!voice||voice.programIndex!==state.currentProgram)continue;const pad=state.programs[voice.programIndex]?.pads[voice.padIndex];if(!pad)continue;const raw=voiceRawPosition(voice),progress=(voice.forceOneShot||pad.mode==="oneshot")?clamp(raw/voice.segmentDuration,0,1):((raw/voice.segmentDuration)%1+1)%1;const el=uiRefs.padProgress[voice.padIndex];if(el)el.style.width=`${progress*100}%`;}}
  function updateMeter(){if(!analyser)return;if(!masterMeterData||masterMeterData.length!==analyser.fftSize)masterMeterData=new Float32Array(analyser.fftSize);const data=masterMeterData;analyser.getFloatTimeDomainData(data);let mean=0;for(let i=0;i<data.length;i++)mean+=data[i];mean/=Math.max(1,data.length);let sum=0,peak=0;for(let i=0;i<data.length;i++){const x=data[i]-mean;sum+=x*x;peak=Math.max(peak,Math.abs(x));}let rms=Math.sqrt(sum/Math.max(1,data.length));if(rms<.00028&&peak<.0012)rms=0;lastMeter=rms===0&&lastMeter<.001?0:lastMeter*.58+rms*.42;const el=uiRefs.masterMeter;if(el)el.style.width=`${clamp(lastMeter*240,0,100)}%`;updateProgramMeters();}
  function updateProgramMeters(){
    const now=performance.now();if(now-lastProgramMeterAt<80)return;lastProgramMeterAt=now;
    for(let i=0;i<PROGRAM_COUNT;i++){
      // UI metering never creates audio nodes. A program bus/analyser exists only after
      // that program actually needs audio, mute/solo or volume control.
      const entry=programMeters.get(i),el=uiRefs.programMeters[i];if(!entry||!el)continue;
      const data=entry.data;entry.analyser.getFloatTimeDomainData(data);let sum=0,peak=0;for(let n=0;n<data.length;n++){const v=data[n];sum+=v*v;peak=Math.max(peak,Math.abs(v));}
      let rms=Math.sqrt(sum/Math.max(1,data.length));if(rms<.00035&&peak<.0015)rms=0;entry.level=rms===0&&entry.level<.001?0:entry.level*.48+rms*.52;el.style.height=`${clamp(entry.level*280,0,100)}%`;
    }
  }
  function updatePositionReadout(){const el=uiRefs.position;if(!el)return;if(!state.transport){el.textContent="1.1.01";return;}const stepDur=beatSeconds()/4,total=Math.max(1,currentProgram().pattern.events.length),pos=Math.max(0,audioCtx.currentTime-transportOrigin),step=Math.floor(pos/stepDur)%total,bar=Math.floor(step/16)+1,beat=Math.floor((step%16)/4)+1,sub=(step%4)+1;el.textContent=`${bar}.${beat}.${String(sub).padStart(2,"0")}`;}
  function updateEditorPlayhead(){const e=state.editor;if(!e?.audition)return;const span=Math.max(.001,e.end-e.start),elapsed=Math.max(0,audioCtx.currentTime-e.auditionStartedAt)*e.auditionRate;e.playhead=e.auditionLoop?e.start+(elapsed%span):Math.min(e.end,e.start+elapsed);let view=editorView();if(e.zoom>1&&(e.playhead<view.start||e.playhead>view.end)){e.center=e.playhead;renderEditorLive();view=editorView();}const pct=(e.playhead-view.start)/view.duration*100,el=document.querySelector("[data-editor-playhead]");if(el)el.style.left=`${clamp(pct,0,100)}%`;}

  audioInput.addEventListener("change",async e=>{await importLocalFiles([...e.target.files]);e.target.value=""});
  folderInput?.addEventListener("change",async e=>{await importLocalFiles([...e.target.files]);e.target.value=""});
  projectInput.addEventListener("change",async e=>{const f=e.target.files?.[0];if(f)await importProjectFile(f);e.target.value=""});
  window.addEventListener("keydown",e=>{
    if(!state.started)return;
    if((e.ctrlKey||e.metaKey)&&e.code==="KeyZ"&&!isEditableTarget(e.target)){e.preventDefault();e.shiftKey?redoAction():undoAction();return;}
    if((e.ctrlKey||e.metaKey)&&e.code==="KeyY"&&!isEditableTarget(e.target)){e.preventDefault();redoAction();return;}
    if(keyboardLearnTarget&&!isEditableTarget(e.target)){e.preventDefault();if(e.code==="Escape"){keyboardLearnTarget=null;renderMain();return;}clearMappingsForAction(keyboardMappings,keyboardLearnTarget.id);keyboardMappings[e.code]={actionId:keyboardLearnTarget.id,label:keyboardLearnTarget.label};saveStoredMap("nt-sampler-keyboard-map",keyboardMappings);const label=keyboardLearnTarget.label;keyboardLearnTarget=null;visualLearnArmed=null;notice(`Keyboard mapeado: ${label}`,"ok",true);if(visualLearnMode)syncVisualLearnTargets();else renderMain();return;}
    if(e.code==="Escape"&&visualLearnMode){e.preventDefault();stopVisualLearn();return;}
    if(e.code==="Escape"&&(midiLearnTarget||state.modal)){e.preventDefault();if(midiLearnTarget){midiLearnTarget=null;renderMain();}else closeModal();return;}
    if(visualLearnMode&&!keyboardLearnTarget)return;
    if(isEditableTarget(e.target)||state.editor||e.repeat)return;const map=keyboardMappings[e.code];if(!map)return;e.preventDefault();downMappedKeys.set(e.code,{actionId:map.actionId,programIndex:state.currentProgram});performMappedAction(map.actionId,1,{source:"keyboard",shift:e.shiftKey});
  });
  window.addEventListener("keyup",e=>{const held=downMappedKeys.get(e.code);if(!held)return;downMappedKeys.delete(e.code);performMappedAction(held.actionId,0,{source:"keyboard",programIndex:held.programIndex});});
  document.addEventListener("pointerdown",e=>{if(state.started)ensureAudioReady({gesture:true});handleVisualLearnPointer(e);},true);
  document.addEventListener("click",e=>{if(visualLearnMode&&e.target.closest?.("[data-learn-action]")){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener("visibilitychange",()=>{if(document.hidden){panic();if(state.transport)stopTransport();audioUnlockDone=false;}else if(state.started){preferPlaybackAudioSession();setTimeout(()=>ensureAudioReady({force:true}),60);}});
  navigator.mediaDevices?.addEventListener?.("devicechange",()=>scanAudioDevices(false));
  window.addEventListener("pageshow",()=>autoInitMidi());
  window.addEventListener("resize",()=>{if(state.editor){drawEditorWave();updateRuler();}});

  const themeGuard=new MutationObserver(()=>{if(document.documentElement.dataset.theme!==activeTheme)applyThemeState();});
  themeGuard.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

  async function bootstrap(){
    await Promise.all([fetchServerFiles(),loadLocalLibrary()]);
    try{const saved=await idbGet("state","autosave");if(saved?.data)applySaved(saved.data);}catch{}
    renderSplash();
    autoInitMidi();
    if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(()=>{});
    animationLoop();
  }
  setTheme(state.theme);
  bootstrap();
})();
