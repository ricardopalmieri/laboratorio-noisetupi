# Hospedagem

As ferramentas web são publicadas como arquivos estáticos, cada uma numa subpasta do servidor. Looper, Sampler e Zine Editor não têm etapa de build: o conteúdo de `apps/<ferramenta>/` é o que se publica. O Video Content Tool publica somente o `dist/` gerado pelo seu build (`npm run package:hostinger`, ver o README do submódulo).

## Requisitos gerais

- **HTTPS obrigatório.** Sem ele o navegador bloqueia microfone, interface de áudio e Web MIDI.
- **Abrir pelo domínio**, nunca por `file://`.
- **`.htaccess` junto.** Cada app traz o seu, com HTTPS forçado, cabeçalhos de segurança e regras de cache para servidores Apache.

## Por ferramenta

| Ferramenta | Servidor | Observações |
|---|---|---|
| NT Video Content Tool | estático | publicar o `dist/` completo, com arquivos legais e `.htaccess` |
| NT Looper | estático | o service worker atualiza o cache; se a versão antiga persistir, fechar o atalho instalado e reabrir a URL |
| NT Sampler | estático + PHP | manter `api.php` e as pastas `js/`, `assets/`, `fonts/`, `samples/`; samples novos entram em `samples/` |
| NT Zine Editor | estático | precisa de rede para o Google Fonts; para URL limpa, publicar `zine-editor.html` também como `index.html` |

## Navegadores

- **Chrome e Edge** em PC e Mac: referência para Looper e Sampler, com Web MIDI e escolha de saída de áudio.
- **Safari no iPad**: o áudio funciona; a saída segue o dispositivo USB conectado, sem troca manual, e não há Web MIDI nativo. Para MIDI no iPad, o Sampler é compatível com o app Web MIDI Browser.
- **Video Content Tool**: exige WebGL2; o MP4 depende dos codecs WebCodecs do navegador.
- O primeiro toque em INICIAR ou TOCAR é obrigatório: navegadores só liberam áudio depois de um gesto do usuário.

## Setup de referência

iPad com hub USB, interface Behringer UMC404HD e controlador Arturia MiniLab 3.
