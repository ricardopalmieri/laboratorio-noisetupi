2.8.0 IPAD MASTER EXPORT / PROGRAM PAGE NAV
- Master recording on iPad/Web MIDI Browser now opens an explicit export modal after stop.
- SHARE / SAVE TO FILES uses the iPad share sheet when supported; OPEN AUDIO and DOWNLOAD are fallbacks.
- Last recorded master remains available in PROJECT until another recording/reload.
- Added PROGRAM previous/next buttons while keeping direct PROGRAM 01-08 access.
- PROGRAM PREVIOUS/NEXT support visual MIDI Learn and Keyboard Learn.
- Existing pad LOOP/GATE MIDI behavior from 2.7.9 was left unchanged.
- Cache bust updated to v280.

NT SAMPLER 2.8.0

NT SAMPLER 2.8.0 - iPad / Desktop
================================

Sampler Web Audio de 16 pads com foco em performance, edição, clock musical e iPad.


2.8.0 MIDI LOOP / FAST GATE
- LOOP MIDI agora filtra Note On/CC positivo duplicado do mesmo toque, comum em alguns bridges/controladores iOS.
- O filtro anti-duplicação é restrito a ações de PAD e usa janela curta de 18 ms, sem prejudicar knobs/faders MIDI CC.
- GATE ganhou estado explícito de press/release com token de geração para impedir corridas entre Note On e Note Off.
- Se o Note Off chegar antes do buffer/rack terminar de preparar, ele não se perde: o hit ainda recebe um pulso mínimo audível de ~26 ms e fecha corretamente.
- Retriggers rápidos substituem pendências antigas em vez de acumular vozes presas.
- Touch e MIDI compartilham a mesma máquina de estado de GATE.
- Cache bust atualizado para v280.

2.7.8 LOW-LATENCY FREE TRIGGER / LOOP TOGGLE
- LOOP passou a usar latch/toggle explícito.
- FREE trigger com caminho quente de baixa latência e prewarm de buffers/racks.
- Note Off é ignorado em LOOP e continua fechando GATE.

2.7.7 iPad WEB MIDI AUDIO / TOUCH DRAG
- Compatibilidade com Web MIDI Browser no iPad, rearm de áudio e drag por Pointer Events.
- Scan de áudio passivo no iOS e UI de output coerente com as limitações do browser.

2.7.6 MIDI / iPad WEB MIDI BROWSER
- Enumeração MIDI compatível com MIDIInputMap legado, forEach(), iterator.next() e onmidimessage.
- midi-diagnostic.html incluído para teste isolado.

NOVIDADES 2.6.2
- Botões de Program restaurados para um tamanho maior, com VU pré-mute em cada Program.
- VU de Program continua ativo em cinza quando o Program está mutado.
- Pitch/Stretch em reprodução trocam por crossfade curto, preservando a posição do sample em vez de esperar o fim do loop.
- Alterações de Pitch/Stretch são pré-calculadas mesmo com o pad parado para reduzir atraso no próximo trigger.
- Compressor broadband do master passa a vir desligado; o preset de fábrica 2.6.0 é migrado automaticamente para evitar pumping causado por graves.

NOVIDADES 2.6
- OSC BOT e performance FX ficam totalmente inativos quando o pad não tem voz ativa, eliminando bleed residual.
- Meter master com remoção de DC e noise floor para não mostrar resíduo numérico como sinal real.
- STOP e MUTE independentes por Program, com bus dedicado e de-click.
- STOP/MUTE de Program podem ser mapeados por MIDI/Keyboard Learn.
- Painel lateral redimensionável e largura persistente.
- Browser mais compacto, com preview menor e linhas mais densas.

BASE 2.5
- Master FX refeito como cadeia serial dry/wet, sem retorno recursivo para o master bus.
- Reverb master com troca de impulse response debounced e crossfade para reduzir estalos ao editar SIZE/MIX.
- Headroom interno antes do master bus e compressor/limiter nativos Web Audio para controle de soma.
- Um único AudioWorklet leve no master para OSC BOT, Pattern Slicer, Sample Slicer, Scatter e Glitch.
- Scatter e Glitch também disponíveis por pad, dentro do mesmo rack persistente do pad.
- PROGRAM switching não reinicia mais o transport nem limpa racks ativos; loops de Programs anteriores podem continuar tocando.
- Banco de 99 patterns por Program, armazenado de forma esparsa para não ocupar memória desnecessária.
- Pattern selector 01-99 e DUP para duplicar rapidamente uma variação.
- Sample Browser redesenhado com tipografia maior, menos molduras e visual cyberpunk.
- Browser com busca, filtros, árvore de diretórios, seleção múltipla, drag/drop no desktop e modal MOVE amigável ao touch.

CORE
- 16 pads / 8 Programs.
- ONE SHOT, GATE e LOOP por pad.
- Trigger FREE ou QUANTIZE por pad.
- Clock mestre baseado em AudioContext.currentTime.
- Pattern Editor de 1 a 64 beats.
- 99 slots de pattern por Program.
- BPM original, detector, FOLLOW MASTER, pitch independente de duração e stretch independente de pitch.
- Trim com waveform, grid BPM, zoom, zero crossing, audition loop e export WAV.
- Undo / Redo.

PAD FX
- Drive
- Delay sync
- Reverb
- Stutter
- Scatter
- Glitch
- OSC BOT
- Pattern Slicer
- Sample Slicer 16-step

MASTER FX / I-O
- Filter / Drive / Delay / Reverb / Stutter
- Scatter / Glitch
- OSC BOT / Pattern Slicer / Sample Slicer
- 4 Band EQ
- Compressor
- Limiter
- Master Volume
- Audio input/output selection where supported
- MIDI controller selection and visual learn

HOSTINGER
Suba todo o conteúdo mantendo index.html, app.js, styles.css, service-worker.js, manifest.webmanifest, api.php e as pastas /js, /assets, /fonts e /samples. Use HTTPS.


2.7.4 UI
- Program volume fader + vertical VU, stop/mute controls
- Pattern launcher/editor modal
- Resizable/hideable side panel and folder tree
- Audio-only browser filtering
- Lightweight SVG pad waveforms
- RED NT, OCEANO and OFF-WHITE themes

2.7.4 UPDATE
- Skin selector moved to I/O.
- Added OFF-WHITE INVERTED skin and contrast fixes for OFF-WHITE.
- VU meters now use a fixed green/yellow/orange/red palette across skins; muted program VU stays grayscale.
- Pause control now uses the supplied SVG silhouette and keeps its markup during transport updates.
- Pad FX and Master FX now use compact add/remove/reorder chain controls instead of showing every effect at once.
- FX chain membership/order is saved with the project. Removed FX are bypassed/off.
- Program mute and volume no longer rebuild the whole interface.
- Program preload no longer performs a second full UI render.
- DSP pad racks are now lazy: opening a full program no longer instantiates one AudioWorklet/rack per loaded pad.
- Program sample preload is staggered to reduce main-thread spikes while switching programs.


2.7.4 ARCHITECTURE / PERFORMANCE FIX
- Skin state is isolated from audio/FX/project snapshots; moving effect parameters no longer touches or resets the selected theme.
- Global transport no longer follows currentProgram. It uses one master 1/16 clock plus independent active program lanes.
- When PLAY is running, visiting another program adds it to the running transport without stopping previously active programs.
- STOP on a program removes that program from the transport lane and stops only its voices.
- Manual pad voices remain independent from program navigation.
- Quantize remains global and uses the same AudioContext clock/origin across all programs.
- Added per-program SOLO, integrated in the existing bus audibility gain (no extra audio path).
- Program and master VUs now use a fixed green/yellow/orange/red palette; muted/solo-suppressed program VUs are gray.
- MIDI access now auto-initializes on reload/pageshow when previously enabled, retries during INICIAR SAMPLER, and restores the last selected input when available.
- MIDI-mapped FX parameters no longer rebuild the I/O panel continuously while a CC is moving.
- Pattern preview voice bookkeeping now uses PROGRAM:PAD keys, avoiding cross-program collisions.


2.7.5 UI / RENDER ARCHITECTURE
- Theme ownership is now exclusive to the document root. The application container no longer carries data-theme, eliminating bubbled control-change events that could reset the skin.
- Theme selector now uses a dedicated data-theme-select hook.
- FX chain selection is deterministic and stored per pad/master. Selecting an FX redraws only the FX editor host instead of rebuilding the whole side panel.
- FX rack handlers are scoped to the side panel, reducing stale/global bindings.
- Pad waveforms use a lightweight filled envelope SVG with no drop-shadow filter. Peaks remain cached/persisted and are generated during idle time.
- Visual refresh rates were reduced independently: pad progress/preview 20 Hz, master meter about 15 Hz, program meters about 12.5 Hz, transport readout 8 Hz. Audio scheduling is unchanged.
- AUDIO RT / latency telemetry remains text-only in the footer.
- Side-panel resizing is capped when its width reaches the pads workspace width, allowing a larger editor/browser without letting the panel overtake the pads.


2.7.7 iPad WEB MIDI AUDIO / TOUCH DRAG
- AudioContext is explicitly re-armed from user gestures for Web MIDI Browser/iPad.
- Audio scan on iPad no longer opens getUserMedia just to enumerate devices, avoiding unwanted iOS route/session changes.
- Unsupported output selection is shown as SYSTEM / iPadOS route instead of an unusable selector.
- REARM AUDIO button restores playback session after backgrounding or host/browser route changes.
- Library samples can be dragged to pads with a dedicated touch drag handle; desktop HTML5 drag/drop is also supported.
- LOAD remains available as the direct one-tap fallback.


2.8.0 LOW-LATENCY FREE TRIGGER / LOOP TOGGLE
- FREE trigger lead reduced to ~1 ms after the buffer/rack is ready.
- Current Program is warmed in background: decoded buffer, pitch/stretch transform and pad rack are prepared before performance whenever possible.
- Reverb impulse for a pad is now created only when pad reverb is actually enabled.
- Pad trigger no longer rebuilds/resends the complete FX rack state on every hit; only the realtime activity gate is updated.
- Expensive side-panel redraw is deferred until after the AudioBufferSource has been scheduled.
- iPad HTMLAudio session priming runs only when audio actually needs unlocking, not on every pad press.
- LOOP is now an explicit latch/toggle: first Note On/touch starts it, the next Note On/touch stops it. Note Off is ignored for LOOP.
- A second LOOP trigger can cancel a start that is still being prepared, preventing double loops/race conditions.
- STOP PAD, STOP PROGRAM and STOP ALL clear the loop latch consistently.
