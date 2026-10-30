// app.js

(function () {
  const status = document.getElementById('boot-status');
  const startButton = document.getElementById('boot-start-btn');
  const boot = document.getElementById('boot-screen');
  const app = document.getElementById('app');
  let engine = null;

  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    status.textContent = 'AUDIO ENGINE';
    try {
      engine = new NSAudioEngine();
      await engine.init();
      await engine.ctx.resume();
      const savedSetup = engine.loadSetup();
      if (!savedSetup) engine.loadFactoryDefaults();
      engine.ensureDefaultChains();
      engine.saveSetup();

      status.textContent = 'MIDI';
      const midi = new NSMidiManager();
      await midi.init();
      const keyboard = new NSKeyboardManager();
      NS_UI.init(engine, midi, keyboard);

      status.textContent = 'AUDIO INPUT';
      try {
        await engine.connectInputDevice('');
        document.getElementById('audio-status-dot').classList.add('live');
      } catch (error) {}
      await NS_UI.refreshDevices(false);

      status.textContent = 'READY';
      setTimeout(() => {
        boot.style.transition = 'opacity .28s ease';
        boot.style.opacity = '0';
        setTimeout(() => { boot.hidden = true; app.hidden = false; }, 290);
      }, 120);
    } catch (error) {
      console.error(error);
      status.textContent = 'START ERROR';
      startButton.disabled = false;
    }
  });

  const resume = () => {
    if (engine && engine.ctx && engine.ctx.state === 'suspended') engine.ctx.resume();
  };
  document.addEventListener('pointerdown', resume, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
