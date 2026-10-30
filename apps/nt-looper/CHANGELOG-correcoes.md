# NT Looper V2.10 - correções aplicadas

## Revisão V2.10

- Learn redesenhado como modo visual sobre a superfície completa, sem exigir pressão longa.
- Seleção do destino por toque ou clique e captura seguinte de nota, CC ou tecla do computador.
- Acesso direto aos 16 pads pelo toolbar do learn.
- Remoção por controle na superfície e remoção individual por linha em Settings.
- Note Off roteado ao mesmo action ID do Note On, corrigindo release dos pads GATE.
- MIDI ativo não dispara controles durante a configuração de novos vínculos.
- Entrada MIDI preferida persistida e reconectada automaticamente após o boot ou reconexão USB.
- Keyboard Learn ignora repetição de tecla, preserva press/release e usa Escape para cancelar uma espera.

## Revisão V2.9.1

- Removido da primeira camada o offset de compensação de latência que avançava o leitor e cortava o ataque inicial.
- A primeira gravação agora define o sample zero absoluto usado por PLAY, waveform, trim e exportação.
- Overdubs continuam recebendo compensação de captura para permanecer alinhadas à camada original.
- Teste dedicado confirma que o primeiro sample gravado é o primeiro sample reproduzido.

## Revisão V2.9

- Nova master timeline é a única autoridade de fase para metrônomo, REC, PLAY e quantize.
- BEAT agenda no próximo pulso e BAR agenda na próxima cabeça de compasso usando um frame absoluto comum a todas as tracks.
- Uma mensagem que chega depois da fronteira é reenfileirada na próxima linha da grade, sem disparo tardio.
- Removida a tolerância retroativa das versões anteriores, que podia fazer click e gravação escolherem pulsos diferentes.
- Gravação com número fixo de compassos reserva a largura total da waveform, evitando redesenho errático durante a captura.
- Detector do Synth ampliado até 45 Hz e validado com A1 em modo de baixa latência.
- Parâmetros binários de FX agora aparecem como botões compactos.
- O comportamento de STOP foi preservado sem alterações nesta revisão.

## Revisão V2.8

- Metrônomo e REC quantizado passam a considerar a latência entre o frame renderizado e o click ouvido.
- Toque logo depois do pulso entra na grade atual dentro de uma janela controlada, sem aguardar outro beat.
- Comprimento do primeiro loop permanece exatamente múltiplo da grade, sem prepad no PCM.
- Latência de I/O, Input FX geral e Input FX da track é guardada como offset de leitura de cada camada.
- Efeitos anteriormente beta ou incompletos receberam implementação dos parâmetros publicados e testes de sensibilidade.
- Módulo inferior das tracks ficou mais estreito e usa colunas fixas para escala, fader, meter, LEDs e botões.
- Splash mostra somente `INICIAR` antes do boot.

## Base V2.7

## Revisão V2.7

- Grafo de saída imutável durante STOP, PLAY e STOP ALL.
- Removidos gates, timers e taps acionados pelo transporte.
- Cada looper envia silêncio ao próprio rack após de-click de 12 ms; as cadeias continuam vivas até a cauda terminar.
- Auxiliar de reverb geral permanentemente conectado ao master bus.
- Repouso DSP baseado em silêncio medido, nunca em tempo estimado de efeito.
- Testes cobrem track 5, independência das outras quatro tracks, de-click contínuo e ausência de mutações no master durante STOP ALL.
- STOP ALL usa um único frame-alvo para as cinco tracks e o mesmo instante para o sampler.

## Revisão V2.6

- Cauda de STOP isolada por track. O master não alimenta mais continuamente o convolver de parada.
- STOP individual captura somente 46 ms da pista acionada, preservando as outras pistas sem gate ou retorno fantasma.
- G2B deixa de forçar toda leitura em direção à oitava anterior.
- Saltos reais de oitava são aceitos após duas análises coerentes; erros isolados continuam bloqueados.
- Testes acrescentados para A4, E5 e isolamento estrutural da cauda.

## Revisão V2.5

- PLAY individual e PLAY ALL reiniciam as pistas no ponto zero depois de STOP.
- Quantize continua definindo quando o PLAY entra, sem alterar o ponto inicial.
- Detector monofônico cobre 65 a 900 Hz em meia taxa e distribui o cálculo entre blocos.
- Vocal Tuner, Synth, G2B e Harmonizer receberam aquisição tonal com confiança e estabilização.
- Harmonizer diatônico calcula duas vozes por tonalidade, escala e graus musicais.
- Caminho dry dos Input FX voltou a ser imediato; compensação de latência permanece apenas nos Track FX.
- Monitor ao vivo ganhou rota dedicada e não atravessa os compressores/limiters com look-ahead do master.
- Foi removido um compressor global redundante antes dos Input FX e outro estágio redundante depois do master rack.
- Perfil iPad usa janelas granulares menores e detector de menor custo.

## Revisão V2.4

- BPM global agora controla a taxa de reprodução das tracks sem alterar o PCM original.
- Quantize, metrônomo, PLAY e FX rítmicos compartilham origem e fase.
- Compensação de latência para Harmonizer, Pitch Shifter e Vocal Tuner em Track FX.
- Fader touch relativo e medidores zerados quando a pista não possui caminho audível.
- Input FX ocioso removido do grafo para reduzir carga de DSP.
- Cópia bidirecional entre as cadeias Input FX e Track FX.
- Drive refeito com seis curvas, filtros por tipo e proteção de pico.
- Status visual verde, amarelo e vermelho baseado na auditoria funcional.

## Revisão V2.3

- Metrônomo e quantize agora compartilham uma origem de transporte persistente.
- Ligar ou desligar o click não desloca a grade de gravação.
- BPM preserva a fase atual do compasso ao atualizar o tamanho do beat.
- Fechamento da primeira gravação logo após a grade remove o excesso e inicia PLAY na fase musical correta.
- Removido o prepad de zeros que criava atraso audível no começo do loop.
- Editor de FX refeito em grade compacta e responsiva, sem cartões repetidos por parâmetro.
- Auditoria funcional dos efeitos incluída em `FX-AUDIT.md`.
- Cache offline renomeado para V2.3.

Este pacote parte do seu `noisetupilooper_v2.0_fixes.zip`. Nenhuma função foi removida;
onde a causa é uma limitação do navegador, isso está marcado abaixo.

## Revisão V2.2

- Botões A-D agora usam toque curto como latch ON/OFF em todos os FX.
- MOMENTARY fica reservado a controles MIDI e teclado com press/release.
- Pressão longa não altera mais o bypass e abre somente os parâmetros.
- Deslocamento do dedo cancela o long press antes da abertura do modal.
- Fader redesenhado com trilho e cap próprios, sem geometria nativa do Safari.
- Escala, fader e meter ocupam colunas fixas sem sobreposição.
- Cache offline renomeado para V2.2.

## Base V2.1

- STOP e STOP ALL preservam a cauda natural, sem baixar o retorno master nem fechar
  antecipadamente o ganho da track.
- O fade local passou para 40 ms com curva equal-power.
- Trim usa pointer capture e não recebe sincronização externa durante o arraste.
- Faders usam geometria rotacionada estável e curso touch virtual de 310 px no iPad.
- O perfil iPad reduz canvas, filtros e frequência de desenho sem reduzir a taxa do áudio.
- Beat Repeat, Roll e Vinyl Flick iniciam em TOGGLE; MOMENTARY continua selecionável.
- AudioWorklets têm canais explícitos, buffers menores e passthrough em erro fatal.
- Cache offline renomeado para V2.1, forçando a substituição dos assets antigos.

## 1) Saída pela UMC404HD no iPad / ideia da frequência 44.1→48k

Adicionado em `SETTINGS > AUDIO I/O`: um seletor **SAMPLE RATE** (AUTO / 44.1 kHz /
48 kHz). Ele passa `sampleRate` na criação do `AudioContext` — como no seu buffer de
áudio, é preciso recarregar o app depois de trocar. AUTO continua sendo o padrão e usa
a taxa preferida pelo dispositivo. Se a rota da UMC404HD estiver fixada em 48 kHz,
selecionar 48 kHz pode evitar resampling, mas não força o iPad a mudar a saída física.

Vale testar também, antes de mexer na frequência: em `SETTINGS > AUDIO I/O`, deixe
`REC ISOLATION` em `DIRECT` (não `AEC`) ao usar a UMC no iPad — o modo `AEC` liga
`echoCancellation`, e isso ativa um caminho de processamento de voz do iOS que é
conhecido por forçar a saída para o alto-falante/fone interno em vez da interface
externa, independente do que estiver selecionado no app. `DIRECT` já é o padrão de
fábrica do projeto.

**Limitação real que não dá para contornar em código:** o app usa
`AudioContext.setSinkId()` para trocar a saída pelo modal — essa API só existe no
Chromium (Chrome/Edge desktop). O WebKit (que é o motor por trás de *todo* navegador em
iPadOS, inclusive o que se chama "Chrome" ou "Firefox" lá) não implementa isso. Por
isso o seletor "AUDIO OUTPUT" do modal nunca teve efeito no iPad — não é regressão,
nunca funcionou ali. Corrigido para não ficar mais confuso: o app agora detecta isso e
mostra um aviso embaixo do seletor explicando que a troca de saída no iPad é feita pelo
Central de Controle do sistema, não pelo app (ver item 3).

## 2) STOP cortando o áudio e depois o "rabo" do reverb

Três bugs de fato, mais um ajuste de design:

- **`importAudioFile` sem fade:** importar um sample para dentro de uma track que
  ainda estava tocando trocava o buffer no worklet instantaneamente, sem fade — daí o
  clique/corte logo depois de importar, e o comportamento estranho de STOP citado por
  você começar a aparecer depois de um import. Agora, se a track estiver
  tocando/sobrepondo, o import primeiro dá STOP com fade e só troca o áudio depois de
  acomodar.
- **Fade de STOP residual:** o worklet de loop não zerava o fade de STOP pendente ao
  carregar um novo áudio (`loadPCM`). Se um fade estivesse em andamento nesse instante,
  ele "vazava" para a próxima reprodução, que nascia sendo cortada sozinha poucos ms
  depois de apertar PLAY. Corrigido.
- **Fade de STOP curto demais:** o fade por track ao apertar STOP era de ~6 ms. Agora
  são 40 ms com curva equal-power, sem alterar o master ou as demais tracks.
- **STOP ALL preserva a ambiência:** todas as tracks e pads param, mas o retorno master
  continua decaindo naturalmente, sem o breve mute que existia na V2.0.

Se depois de testar você ainda achar o "rabo" longo demais no STOP individual de uma
track (isso é esperado por design, não bug), dá pra reduzir ou desligar em
`SETTINGS > GENERAL > STOP TAIL`.

## 3) "Master out" só muda pelo Settings do iPad, não pelo modal

Mesma raiz do item 1: o seletor de saída do modal depende de `setSinkId`, que o Safari
não implementa. Isso não tem solução via JavaScript — é uma limitação do WebKit em
iPadOS. O que foi feito: o app agora reconhece essa limitação e mostra um aviso no
próprio modal (`SETTINGS > AUDIO I/O`) explicando que no iPad a saída é escolhida pelo
Central de Controle / AirPlay do sistema, e que a UMC404HD normalmente vira a saída
padrão do sistema sozinha ao ser conectada por ser um dispositivo USB classe-áudio (não
Bluetooth). O seletor no modal fica desabilitado nesse caso, em vez de parecer quebrado.

## 4) Botão fullscreen

Adicionado um botão de tela cheia (⤢) ao lado do ⚙ no cabeçalho, usando a Fullscreen
API padrão do navegador e a variante `webkit`. Quando a API não existe, o botão orienta
a instalar o app com “Adicionar à Tela de Início”.

## 5) Trim (IN/OUT) perdendo o arraste do mouse/touch

Causa raiz encontrada: o código clampava os dois sliders (IN e OUT) escrevendo de volta
o `.value` do slider que o usuário estava arrastando no momento, sempre que os dois
handles chegavam perto um do outro. Reatribuir `.value` de um `<input type=range>`
*durante* o gesto de arraste é conhecido por interromper o arraste em WebKit/Safari (e
ocasionalmente em outros navegadores) — o slider "trava" ou perde o movimento seguinte
até soltar e tocar de novo.

Corrigido nos dois lugares que tinham esse padrão (trim da track e trim de cada pad do
sampler): em vez de reescrever o valor do slider ativo, o app agora só ajusta o `min`/
`max` do slider oposto, deixando o próprio `<input type=range>` nativo impedir que os
dois se cruzem — sem nunca tocar no valor do slider que está sendo arrastado. Isso
resolve tanto no mouse quanto no touch.

## 6) Vários efeitos não ligam no iPad

Causa raiz encontrada nos botões rápidos A/B/C/D de cada rack (IN FX / TRACK FX) na
mesa: a ação de ligar/desligar o efeito dependia do evento `click` sintético do
navegador, disparado depois de uma lógica própria de "toque curto vs. segurar" feita
com Pointer Events. Em iOS, quando o sistema interpreta um toque como possível gesto de
rolagem (comum perto do carrossel de tracks), ele dispara `pointercancel` em vez de
completar o toque — e nesse caso o Safari nunca dispara o `click`, então o botão do
efeito simplesmente não fazia nada. Isso é intermitente por natureza (só acontece
quando o iOS decide cancelar o toque), o que bate com "vários efeitos" em vez de
"nenhum efeito".

Corrigido: o toggle agora acontece direto no `pointerup` (sem depender do `click`
sintético), em todas as plataformas. O `click` continua existindo só como caminho de
acessibilidade (teclado/leitor de tela), sem duplicar a ação. Os racks de FX no modal
(abrir parâmetros, bypass, mover, remover) já usavam `click` simples sem essa lógica
extra e não precisaram de mudança; os pads do sampler já tratavam isso corretamente
desde o início.

## Como testar

1. Recarregue o app depois de instalar (ou dê hard-refresh / limpe o cache do PWA) —
   principalmente por causa da troca de SAMPLE RATE.
2. UMC404HD no iPad: teste com `REC ISOLATION = DIRECT` primeiro; se ainda sair só pelo
   alto-falante, tente forçar `SAMPLE RATE = 48 kHz` em Settings e recarregue.
3. Importe um sample numa track tocando e dê STOP algumas vezes seguidas — não deve
   mais cortar seco nem "vazar" fade para a próxima reprodução.
4. Aperte STOP ALL com reverb/delay tocando — a cauda deve sumir rápido, não ficar
   tocando por ~2 s como antes.
5. No modal de trim (track e sampler), arraste IN e OUT bem devagar até quase se
   tocarem, no mouse e no touch — o arraste não deve mais travar.
6. Nos botões A/B/C/D da mesa (IN/TRACK FX), toque várias vezes seguidas em sequência
   rápida no iPad — deve ligar/desligar de forma consistente.
