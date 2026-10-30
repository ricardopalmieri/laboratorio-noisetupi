# NT LOOPER V2.10

Looper de mesa estático da linha Laboratório Noisetupi. O motor usa Web Audio API e AudioWorklet, com Chrome como navegador principal.

## Instalação na Hostinger

1. Envie todo o conteúdo da pasta `nt-looper` para `public_html/looper/`.
2. Mantenha o arquivo `.htaccess` na raiz dessa pasta.
3. Abra `https://seu-dominio.com/looper/`.
4. No primeiro acesso, toque em `TOCAR` e autorize a entrada de áudio.
5. Se uma versão anterior continuar aparecendo, feche o atalho instalado e abra a URL novamente. A V2.10 atualiza o cache offline automaticamente.

O site precisa estar em HTTPS. Não requer PHP, Node, banco de dados ou processamento no servidor.

## Áudio

- Cinco tracks independentes.
- Até 3 minutos por loop.
- Até 3 camadas por track.
- REC, PLAY, OVERDUB e STOP individuais.
- Undo e redo da última camada por track.
- Trim não destrutivo com IN e OUT.
- Download WAV estéreo da track já somada e trimada.
- Importação de WAV, MP3, M4A, AAC, OGG, WebM e FLAC quando o codec é aceito pelo Chrome.
- Exportação de todas as tracks em um ZIP de arquivos WAV.
- Fader por track de silêncio até +6 dB.
- Ganho de entrada por track até +12 dB.
- EQ de entrada de três bandas por track.
- Mute, solo e monitor de entrada por track.
- Gravação do mix master.
- Ganho global de entrada de -12 dB a +36 dB.
- Click com volume individual.
- BPM com TAP.
- Quantize FREE, BEAT e BAR compartilhado por metrônomo, REC, PLAY e FX rítmicos.

## Estabilidade DSP

O Settings de áudio oferece três buffers:

- `REALTIME`: padrão, pede ao Chrome a menor latência disponível.
- `BALANCED`: preserva baixa latência com mais margem para efeitos.
- `SAFE`: maior proteção contra glitches em tablets ou racks pesados.

Depois de trocar o buffer, recarregue o app. O painel mostra sample rate, latência reportada pelo Chrome e um índice `DSP LIGHT`, `MEDIUM` ou `HIGH`.

A V2.10 mantém o processamento de FX em bypass fora do grafo, suspende completamente o Input FX de pistas ociosas e usa uma master timeline sample-accurate para metrônomo, quantize, REC, PLAY e FX rítmicos. Em BEAT ou BAR, toda ação é agendada para uma fronteira futura exata. O REC guarda compensação de I/O e Input FX apenas nas overdubs, sem alterar o PCM original nem avançar o começo da primeira camada. O caminho original dos Input FX permanece imediato. Somente transformações granulares carregam sua latência inevitável. O modo REALTIME solicita 5 ms ao AudioContext. O navegador pode escolher outro valor conforme o hardware.

## Novidades da V2.10

- MIDI Learn e Keyboard Learn funcionam visualmente sobre toda a mesa.
- Azul indica controle mapeável, verde indica vínculo existente e amarelo indica espera por MIDI ou tecla.
- REC/PLAY, STOP, volumes, Mute, Solo, Monitor, Undo, Redo, FX, controles gerais e os 16 pads podem ser mapeados.
- O botão PADS do learn abre o sampler sem abandonar o modo de mapeamento.
- REMOVE apaga todos os vínculos do controle selecionado; cada linha em Settings também possui remoção individual.
- Note Off usa o mesmo vínculo do Note On, permitindo GATE e MOMENTARY reais.
- O controlador MIDI preferido é reconectado automaticamente no Chrome e Edge para PC ou Mac.
- Mapeamentos permanecem salvos localmente no navegador.

## Base preservada da V2.9.1

## Correção da V2.9.1

- A primeira camada mantém offset zero e preserva integralmente o ataque no início do loop.
- A compensação de latência permanece ativa nas overdubs, onde existe uma pista anterior como referência.
- A waveform final e o primeiro PLAY passam a usar exatamente o mesmo sample zero capturado pelo REC.

## Base preservada da V2.9

## Novidades da V2.9

- Master timeline única para click, REC, fechamento de REC, PLAY individual e PLAY ALL.
- BEAT libera a ação somente no próximo pulso; BAR somente na próxima cabeça de compasso; FREE permanece imediato.
- Mensagens atrasadas nunca entram fora da grade: são movidas para a próxima fronteira válida.
- Waveform de gravação com duração fixa reserva o eixo completo antes do primeiro sample e não reposiciona os picos durante o REC.
- Synth passa a rastrear fundamentais de 45 a 900 Hz, incluindo vozes e instrumentos graves.
- Parâmetros binários de efeitos usam botões compactos no lugar de sliders.

## Base preservada da V2.8

- REC, metrônomo e quantize consideram o pulso efetivamente ouvido, mantendo o tamanho exato da grade.
- Compensação de latência de interface e Input FX gravada como metadado por camada.
- Todos os efeitos do catálogo têm parâmetros publicados ligados ao DSP e passam a estado verde.
- Beat Scatter, Beat Shift, Vinyl Flick, Freeze, Warp, Twist, Radio, Preamp e Octave foram refeitos.
- Fader, escala, meter, LEDs e botões inferiores usam colunas físicas fixas e mais compactas.
- Splash reduzida ao botão `INICIAR`.

## Base preservada da V2.7

- Core de saída refeito como canais independentes de DAW: transporte e grafo de áudio agora são sistemas separados.
- STOP individual e STOP ALL alteram somente o estado dos AudioWorklets das tracks e pads.
- Removidos Output Gate, timers de cauda, ramps de saída e reverb disparado pelo botão STOP.
- Track FX e master FX permanecem conectados ao receber silêncio, preservando reverbs, delays e feedbacks.
- Reverb geral funciona como auxiliar contínuo do master bus, sem automação provocada pelo transporte.
- De-click local reduzido para 12 ms e aplicado exclusivamente à fonte da track.
- Rack de saída entra em repouso somente após aproximadamente sete segundos abaixo de -90 dB, protegendo delays com intervalos longos.
- Teste dedicado para STOP da track 5 confirma que as outras quatro mantêm nível constante.
- STOP ALL foi protegido contra qualquer acesso a master gain, master FX e retornos de reverb.
- STOP ALL agenda as cinco tracks e o sampler no mesmo frame de áudio, com dois quanta de margem para entrega no AudioWorklet.

## Novidades da V2.6

- A cauda de STOP não recebe mais o master continuamente. Cada track possui um tap próprio, aberto somente por 46 ms quando ela recebe STOP.
- Parar uma track não devolve mais um fantasma das outras pistas pelo convolver compartilhado.
- G2B aceita oitavas realmente cantadas após duas análises coerentes, sem dobrá-las de volta para a nota anterior.
- Rastreamento do G2B passa a dominar integralmente a frequência de BASE no valor máximo.
- Mediana tonal reduzida para três leituras e calculada sem alocações, diminuindo retenção de notas e pressão de memória no iPad.

## Novidades da V2.5

- STOP seguido de PLAY sempre reinicia a track no começo, aguardando a grade quando o quantize está ligado.
- STOP ALL e PLAY ALL seguem a mesma regra de reinício.
- Detector YIN refeito em meia taxa, com alcance real até 65 Hz, confiança, mediana temporal e proteção contra saltos de oitava.
- Vocal Tuner reconhece melhor vozes graves e usa janela granular menor no iPad.
- Harmonizer ganhou modos FIXED e DIATONIC, root, scale, graus independentes e controle de tracking.
- Synth e G2B seguem a fundamental monofônica da entrada. A frequência manual permanece como referência e fallback.
- Input FX não atrasa mais o caminho dry para alinhá-lo artificialmente ao wet, reduzindo a latência percebida no monitor.
- Monitor ao vivo possui uma rota curta própria, preservando Input FX, ganho, pan, mute/solo e master gain sem atravessar o look-ahead do kit de master.
- A análise tonal é distribuída entre render quanta e só roda quando o efeito que precisa dela está ativo.

## Novidades da V2.4

- Mudança do BPM global altera velocidade e pitch de todas as tracks usando leitura fracionária no AudioWorklet, sem reescrever o PCM original.
- PLAY de uma pista parada entra na grade compartilhada e reinicia pelo começo.
- Beat Repeat, Scatter, Roll, Slicers, Freeze e OSC BOT recebem a mesma origem absoluta do metrônomo.
- Harmonizer, Pitch Shifter e Vocal Tuner informam a latência ao rack. A reprodução da track faz compensação antecipada e o caminho dry é atrasado pelo mesmo valor.
- Faders no iPad usam somente arraste relativo, com curso maior. Tocar fora do cap não zera o volume.
- Medidores de pista desligada mostram zero real. O Input FX sai do grafo quando MON, REC e DUB estão desligados.
- Cadeias completas podem ser copiadas de Input FX para Track FX e no sentido inverso.
- Drive ganhou curvas distintas Vocal, Boost, OD, DS, Metal e Fuzz, pré-ganho e contenção de pico.
- Na V2.4, efeitos ainda usavam verde, amarelo e vermelho para separar o estágio da implementação.

## Novidades da V2.3

- O click não recria mais a origem do transporte ao ser ligado ou desligado.
- Mudanças de BPM preservam a fase musical do compasso e atualizam click, quantize e FX no mesmo ciclo.
- O fim da primeira gravação usa tolerância retroativa: se o comando chega logo após a linha, remove apenas o excesso e entra em PLAY na fase correta.
- Foi removido o preenchimento de silêncio que atrasava o primeiro PLAY.
- O modal de FX usa grade compacta de 3 colunas no tablet, 2 no telefone e 4 em landscape baixo.
- Controles individuais perderam caixas e margens desnecessárias; o scroll fica como fallback apenas para efeitos excepcionalmente grandes.
- A auditoria original separava efeitos estáveis, beta e candidatos a refazer; a V2.8 fecha essa lista.
- Testes automatizados cobrem fechamento de REC na grade e todos os 20 processadores AudioWorklet registrados.

### Baixa latência no Windows com UMC404HD

1. Em Settings, selecione a UMC como entrada e saída, escolha `REALTIME` e recarregue o app.
2. No Windows, configure reprodução e gravação da UMC com o mesmo formato, preferencialmente 48 kHz e 24 bits.
3. Desative aprimoramentos de áudio e áudio espacial da UMC.
4. Conecte os fones diretamente à UMC e evite saídas Bluetooth.
5. Para monitor sem atraso, desligue `MON` no app e use o controle `MIX` da UMC em direção a `IN`. O loop continua vindo de `PB 1-2`.
6. Para escutar Input FX processado, use `MON` no app. Esse caminho passa pelo Chrome e mantém alguma latência, especialmente com Harmonizer e Vocal Tuner.

O Chrome usa o sistema de áudio compartilhado do Windows, não o buffer ASIO configurado para uma DAW. O monitor direto da UMC é o único caminho realmente sem round trip.

## Novidades da V2.2

- Toque curto nos FX A-D sempre alterna ON/OFF, inclusive quando o parâmetro de trigger está em MOMENTARY.
- MOMENTARY continua respondendo a press/release pelo MIDI Learn e Keyboard Learn.
- Pressão longa abre parâmetros sem ligar temporariamente o efeito.
- Movimento do dedo cancela a pressão longa e evita abertura acidental do modal.
- Fader visual próprio, sem depender do thumb vertical ou rotacionado do navegador.
- Cap, trilho, escala e medidor ficam em colunas fixas e alinhadas em desktop e iPad.

## Base V2.1

- STOP individual e STOP ALL sem duck da cauda master e sem fechamento antecipado do caminho da track.
- Fade equal-power de 40 ms no próprio AudioWorklet, inclusive para samples importados.
- Fader touch independente da geometria vertical nativa do Safari, com cap menor e curso virtual de precisão.
- Trim IN/OUT com pointer capture e proteção contra sincronização durante o arraste.
- Perfil gráfico automático para iPad, com canvas em 1x, waveforms a 15 fps e medidores a 20 fps.
- Beat Repeat, Roll e Vinyl Flick abrem em TOGGLE; MOMENTARY continua disponível no modal.
- AudioWorklets estéreo explícitos, buffers DSP menores no iPad e passthrough de segurança em erro do processor.
- Sample rate AUTO, 44.1 kHz e 48 kHz, com fallback para a taxa aceita pelo dispositivo.
- Botão de tela cheia com fallback para instalação na tela inicial.

- Volume individual de 0 a +3.5 dB por pad e fader master do sampler na mesa.
- STOP ALL encerra tracks e todas as vozes do sampler com fade curto.
- Keyboard Learn persistente para controles de performance e pads.
- Cabeçalho fluido e tracks em carrossel uniforme com snap para iPad.
- Beat Scatter, Beat Repeat, Beat Shift, Vinyl Flick, Pattern Slicer, Step Slicer, Roll, Freeze, Warp e Twist.
- Radio, Preamp, Synth, G2B, Sustainer, Slow Gear, Octave, Reverse Delay e Mod Delay.
- Lista de efeitos em ordem alfabética e proteção de pico nos novos AudioWorklets.
- Opção ORIGINAL MUTE/THRU em Harmonizer, Pitch Shifter, Vocal Tuner, OSC BOT, Synth, G2B e Octave.

- Sampler de 16 pads com bancos de cor por linha.
- Arquivos locais com trim, BPM original, normal, reverse e pingpong.
- Triggers GATE, TOGGLE e PLAY, sempre reiniciando o sample pelo começo.
- Pads ativos acompanham mudanças do BPM mestre em tempo real.
- Áudios e configurações dos pads incluídos nos projetos `.ntloop`.
- PITCH SHIFTER de -24 a +24 semitons sem alterar a duração da track.
- Vocal Tuner com análise distribuída entre blocos, transição contínua na região de afinação neutra e proteção suave de pico.
- Caps dos sliders orientados conforme o eixo: horizontais largos e verticais altos.
- OSC BOT com `DRY INPUT`: `MUTE` usa a voz como guia sem enviá-la à saída; `THRU` mantém voz e synth.
- Modo de áudio `REALTIME` como padrão em instalações novas.
- Captura solicita a menor latência disponível ao navegador.
- Waveforms maiores e layout responsivo para desktop e tablet.
- Faders com curva em dB, região de trabalho ampliada próxima de 0 dB e leitura numérica.
- Medidores de entrada em tempo real na mesa e no modal de cada track.
- Botões A-D por track para bypass instantâneo de cada Input FX e Track FX. Pressão longa abre os parâmetros.
- Cópia completa de ganho, EQ, pan e racks entre tracks.
- OSC BOT com sequenciador de 16 passos sincronizado ao BPM.
- Vocal Tuner com modos Electric e Robot, nota raiz e cinco escalas.
- Template CLEAN com apenas compressor e limiter na master.
- Metrônomo e quantize ligados ao mesmo transporte no AudioWorklet.
- Compensação de fase no início da primeira gravação.
- STOP por track com fade local, sem alterar o ganho master ou as outras tracks.
- Harmonizer e Vocal Tuner com transições de pitch suavizadas.
- Faders vermelhos com cap estriado e medidores LED de pico.
- Setup e projeto atualizados para o formato V13.
- STOP individual e STOP ALL sem reconstruir o grafo de saída durante o áudio.
- Tail master sobreposto à rampa final, sem intervalo de silêncio.
- Grade de REC alinhada ao mesmo relógio do metrônomo, com compensação de latência na entrada da batida.
- AudioWorklets de OSC BOT, Vocal Tuner, Harmonizer e Lo-Fi permanecem ativos enquanto o FX está ligado.
- REC MIX exporta WAV PCM estéreo sem MediaRecorder/WebM.
- Nomes dos FX visíveis nos botões A-D da mesa.

## Roteamento

O caminho de gravação e o caminho de reprodução não se conectam entre si:

`audio input > input strip > global input FX > track input gain/EQ/FX > looper`

`looper > track FX > track fader/pan > master FX > limiter > audio output`

O botão `MON` de cada track monitora o sinal de entrada já processado pelo Input FX daquela track. Ele não precisa estar ligado para gravar.

`REC ISOLATION · DIRECT` mantém a captura musical sem cancelamento. `AEC` pode reduzir o vazamento acústico quando o loop toca em caixas e volta pelo microfone, mas pode alterar timbre e ataques. Para performance, use DIRECT com fones ou roteamento físico sem loopback.

## Efeitos

Cada track possui dois racks independentes:

- IN FX, impresso na gravação.
- OUT FX, aplicado apenas na reprodução.

Cada rack aceita quatro efeitos, com bypass, intensidade, parâmetros próprios e mudança de ordem. As cinco tracks já abrem com quatro slots de Input FX e quatro de Track FX configurados. O banco em ordem alfabética inclui os módulos tradicionais e as famílias Beat Scatter, Beat Repeat, Beat Shift, Vinyl Flick, Pattern Slicer, Step Slicer, Roll, Freeze, Warp, Twist, Radio, Preamp, Synth, G2B, Sustainer, Slow Gear, Octave, Reverse Delay e Mod Delay.

O Harmonizer roda em AudioWorklet com duas vozes granulares. O controle `QUALITY` aumenta a janela e a estabilidade do pitch, com mais latência. Para voz, comece entre 65 e 85 ms.

## Setup

`SETTINGS > GENERAL > SAVE SETUP` salva localmente BPM, quantize, ganhos, EQ, racks de efeitos, parâmetros, tail e volumes. Presets podem ser importados e exportados em JSON.

`SAVE PROJECT` cria um arquivo `.ntloop` com setup, áudio das tracks e banco de samples dos 16 pads. `OPEN PROJECT` reabre esse arquivo no mesmo navegador ou em outro dispositivo. O áudio das tracks reabertas fica consolidado em uma camada por track.

O banco interno oferece templates BOSS STYLE para Factory, Ambient, Beatbox, Glitch e Vocal Lab. São configurações inspiradas no fluxo de bancos A-D do equipamento, sem samples proprietários.

O master abre com compressor e limiter ativos.

## MIDI

Ative MIDI Learn em `SETTINGS > MIDI`. Segure por 600 ms o controle da interface e mova ou pressione o controle MIDI.

No mesmo painel, `KEYBOARD LEARN` mapeia teclas do computador. Segure um botão da mesa ou um pad e pressione a tecla desejada. Os mapas MIDI e teclado ficam salvos localmente.

Web MIDI funciona no Chrome e Edge de desktop. Chrome no iPad continua usando WebKit e não oferece Web MIDI. No iPad, use touch ou um navegador que implemente a ponte CoreMIDI.
