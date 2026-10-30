# NT Sampler 2.8.0

Sampler de 16 pads em Web Audio para iPad e desktop. Visão geral em [`docs/plataforma.md`](../../docs/plataforma.md#nt-sampler).

- `index.html`, `app.js`, `styles.css`: aplicação
- `js/`: processadores AudioWorklet (pads e efeitos)
- `api.php`: lista os arquivos de `samples/` para o navegador de samples (única parte que precisa de PHP)
- `samples/`: samples de fábrica e `manifest.json`
- `midi-diagnostic.html`: teste isolado do controlador MIDI
- `README.txt`: histórico de versões e instruções originais
