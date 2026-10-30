# Plataforma

## O que é

O Laboratório Noisetupi é um programa de criação audiovisual com ferramentas próprias que rodam no navegador. Cada laboratório parte de um desafio de criação, que pode vir de uma demanda da instituição, de uma questão do território ou de um percurso pedagógico. O ciclo é experimentar, criar e compartilhar, e todo laboratório termina com uma peça feita pelos participantes. A cadeia de trabalho vai da ideia ao som, à imagem, ao texto e à peça audiovisual.

A mediação se apoia em Paulo Freire: temas que vêm da comunidade, criação como produção de conhecimento e autonomia de quem participa.

As ferramentas são livres e gratuitas. As instituições contratam a experiência, a metodologia, a formação de educadores e a mediação.

## Princípios técnicos

Comuns às quatro ferramentas. Mudanças no código devem preservar estes pontos:

- **Sem instalação.** Abre por URL em navegador atual.
- **Sem login e sem conta.**
- **Processamento local.** Áudio, vídeo e imagem são gravados, processados e exportados no dispositivo. O servidor entrega arquivos estáticos e não recebe conteúdo do usuário.
- **Arquivos do usuário ficam com o usuário.** Projetos são salvos no navegador (IndexedDB, localStorage) ou exportados como arquivo para levar a outro dispositivo.
- **Hospedagem simples.** HTML, CSS e JavaScript estáticos, publicáveis em hospedagem compartilhada comum. O único trecho de servidor é o `api.php` do NT Sampler, que apenas lista a pasta de samples.
- **Tablet como alvo.** iPad e tablets ao lado de PC. Áreas de toque grandes e interface sem texto explicativo, só o nome de cada controle.

## Ferramentas

### NT Video Content Tool

Editor de motion graphics, videomapping e vídeo.

Versão 0.7.2, em submódulo com repositório próprio. TypeScript + Vite, compositor WebGL2 com efeitos GLSL próprios, exportação MP4 por WebCodecs e sequência PNG com alpha. Interface em português e inglês. Timeline com múltiplos clipes, faixas nomeadas, bin de mídia, região de trabalho e grade musical (BPM, compassos, tap tempo). Legenda automática local com Whisper (Transformers.js, WebGPU ou WebAssembly). Projetos `.ntvct`, coleta de mídias em ZIP portátil e autosave de recuperação no IndexedDB. API de automação `window.vct` para agentes de navegador, com registro único de comandos, lotes, `dryRun`, desfazer nomeado, análise de áudio e folhas de contato. Testes unitários e de paridade com a versão 0.6.2.

### NT Looper

Looper de mesa inspirado no fluxo da BOSS RC-505 mk2, com engine própria em Web Audio API e AudioWorklet. Chrome é o navegador de referência.

- 5 tracks, até 3 minutos por loop e 3 camadas por track, com undo e redo da última camada
- REC / PLAY / OVERDUB, gravação livre ou por número de compassos
- Master timeline sample-accurate para metrônomo, quantize (FREE, BEAT, BAR), REC, PLAY e FX rítmicos
- Input FX, Track FX e Master FX; catálogo com reverb, delays, harmonizer, vocal tuner por escala, osc-bot com sequencer, entre outros
- Trim não destrutivo, export WAV por track, export ZIP de todas as tracks, gravação do mix master
- MIDI Learn e Keyboard Learn visuais sobre toda a mesa, 16 pads de sampler integrados
- Três perfis de buffer (REALTIME, BALANCED, SAFE)
- Testes do AudioWorklet em `tests/worklet-tests.js`

Histórico técnico em `CHANGELOG-correcoes.md` e auditoria dos efeitos em `FX-AUDIT.md`.

### NT Sampler

Sampler de 16 pads com foco em performance, para iPad e desktop.

- 8 programs com navegação direta e anterior/próximo, volume, VU, STOP, MUTE e SOLO por program
- Pads em LOOP (latch) e GATE, pitch e stretch com crossfade, clock 1/16 único com quantize global
- Pad FX e Master FX em cadeias reordenáveis, processamento em AudioWorklet
- Editor de padrões, navegador de samples com árvore de pastas
- MIDI Learn e Keyboard Learn, compatível com o Web MIDI Browser no iPad (`midi-diagnostic.html` testa o controlador)
- Gravação do master com exportação pelo menu de compartilhamento do iPad
- Temas RED NT, OCEANO, OFF-WHITE e OFF-WHITE INVERTED

Histórico de versões em `README.txt`.

### NT Zine Editor

Editor de fanzines em um único arquivo HTML (`zine-editor.html`).

- Páginas com camadas de imagem e texto, recorte de imagem, duplicação de página e elemento
- Imposição para impressão: caderno com dobra e grampo, zine de 8 páginas dobrado, leitura 2-up
- Exportação em PDF simples e PDF imposto em A4, preset xerox
- Salvamento local e projeto em `.json`
- Content-Security-Policy restritiva: sem scripts externos, sem chamadas de rede, imagens só `data:` e `blob:`

## Pilha técnica

| | Video Content Tool | Looper | Sampler | Zine Editor |
|---|---|---|---|---|
| Linguagem | TypeScript | JavaScript | JavaScript | JavaScript inline |
| Build | Vite | nenhum | nenhum | nenhum |
| Mídia | WebGL2, WebCodecs, Web Audio | Web Audio, AudioWorklet | Web Audio, AudioWorklet | Canvas, PDF |
| Persistência | IndexedDB + `.ntvct` | navegador + `.ntloop` | IndexedDB | localStorage + `.json` |
| MIDI | não | Web MIDI | Web MIDI | não |
| Servidor | estático | estático | estático + `api.php` | estático |
| Testes | Vitest, Playwright | worklet em Node | não | não |

## Design system

O NT Video Content Tool é a referência visual da suíte, e o NT Looper segue essa referência:

- Fontes: IBM Plex Mono, IBM Plex Sans, Space Grotesk, Syne, empacotadas localmente
- Cores: superfície `#0d0d0c`, vermelho `#ce111b`, verde `#7cb87d`, âmbar `#d9a441`
- Tela de abertura com o logo da Noisetupi e um único botão de início
- Opções complexas em modais de settings por item, superfície principal limpa

O NT Sampler tem temas próprios e o NT Zine Editor usa paleta e fontes próprias. A unificação está no [roadmap](roadmap.md).
