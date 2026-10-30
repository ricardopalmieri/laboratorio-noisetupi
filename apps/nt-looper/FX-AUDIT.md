# Auditoria de efeitos - V2.9

Verde agora significa que os parâmetros publicados estão ligados ao DSP, a saída passou pelos testes de continuidade e o efeito não silencia a cadeia. Isso não afirma identidade sonora com o hardware BOSS, pois uma comparação desse tipo exige medição A/B com o equipamento.

## Efeitos finalizados nesta revisão

| Efeito | Implementação V2.9 |
|---|---|
| Beat Repeat / Roll | Captura por divisão musical, forward, reverse, alternado, gate, feedback e sincronismo opcional com a grade global |
| Beat Scatter | Oito padrões, randomização determinística por seed, escolha estável por passo, direção, intensidade e retrigger por compasso |
| Beat Shift | PAST lê o histórico; FUTURE lê a fase adiantada do compasso anterior já capturado, evitando acesso causal impossível a áudio ainda inexistente |
| Vinyl Flick | Velocidade contínua positiva ou reversa, inércia, fricção e retorno progressivo à velocidade normal |
| Pattern / Step Slicer | Padrões, duty, attack, depth e níveis independentes dos 16 passos |
| Freeze | Janela musical repetida com attack, release e sustain |
| Warp / Twist | Modulação temporal estéreo, amount, rate, feedback e largura estéreo |
| Reverse Delay | Leitura reversa sincronizada, feedback, low-cut e high-cut |
| Radio | Bandwidth, ruído colorido determinístico, drive, tone e level |
| Preamp | Modelos Clean, Crunch, Stack e High Gain com curvas, filtros, gain, tone e level próprios |
| Synth / G2B | Detector monofônico de 45 a 900 Hz, tracking, envelope e tone no G2B |
| Octave | Detector tonal ativo, sub-osciladores de -1 e -2 oitavas e direct level |
| Sustainer / Slow Gear | Seguidores de envelope com todos os controles publicados ligados ao ganho |
| Harmonizer / Pitch Shifter / Vocal Tuner | Processamento granular, aquisição tonal, compensação declarada de latência e opção de suprimir o sinal original |

## Proteções e testes

- Randomização rítmica nunca muda a posição a cada sample.
- Feedbacks são limitados antes de realimentar os buffers.
- Saídas dos AudioWorklets passam por saturação suave de segurança.
- Todos os 20 processadores são testados contra silêncio acidental, `NaN` e infinito.
- Testes de sensibilidade confirmam que pattern, duty, gesture, stereo, low-cut e níveis de oitava alteram o sinal.
- FX rítmicos recebem BPM e origem do mesmo transporte usado pelo metrônomo e pelo quantize.
