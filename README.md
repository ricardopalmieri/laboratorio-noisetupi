# Laboratório Noisetupi

Suíte de criação no navegador desenvolvida pela Noisetupi Produções Audiovisuais (Santo André, SP). Reúne ferramentas de som, imagem em movimento e publicação impressa para oficinas, escolas, museus e centros culturais.

As ferramentas rodam no navegador, sem instalação e sem login. As mídias são processadas no próprio dispositivo de quem usa: nada do que se grava, edita ou monta é enviado a um servidor.

## Ferramentas

| Ferramenta | Pasta | Versão | Função |
|---|---|---|---|
| NT Video Content Tool | [`apps/nt-video-content-tool`](https://github.com/ricardopalmieri/NT_VideoContentTool) | 0.7.2 | motion graphics, videomapping, edição de vídeo e legenda automática |
| NT Looper | [`apps/nt-looper`](apps/nt-looper) | 2.10 | gravação em camadas e performance ao vivo, 5 tracks |
| NT Sampler | [`apps/nt-sampler`](apps/nt-sampler) | 2.8.0 | 16 pads, programs, padrões e efeitos |
| NT Zine Editor | [`apps/nt-zine-editor`](apps/nt-zine-editor) | sem número | edição de fanzine e imposição para impressão A4 |

O NT Video Content Tool tem repositório próprio, [ricardopalmieri/NT_VideoContentTool](https://github.com/ricardopalmieri/NT_VideoContentTool), incluído aqui como submódulo em `apps/nt-video-content-tool`.

## Clonar

```cmd
git clone --recurse-submodules https://github.com/ricardopalmieri/laboratorio-noisetupi.git
```

Se o repositório já foi clonado sem o submódulo:

```cmd
git submodule update --init
```

## Rodar localmente

Looper, Sampler e Zine Editor são estáticos. Qualquer servidor HTTP local serve:

```cmd
cd apps\nt-looper
python -m http.server 8080
```

Abra `http://localhost:8080`. Microfone e MIDI exigem `localhost` ou HTTPS. O NT Sampler usa `api.php` para listar a pasta `samples/`; sem PHP o app abre, mas a biblioteca de samples do servidor não aparece.

O NT Video Content Tool usa Node.js e Vite. Instruções no README do submódulo.

## Documentação

- [Plataforma](docs/plataforma.md): princípios, ferramentas, pilha técnica e design system
- [Hospedagem](docs/hospedagem.md): publicação e requisitos de navegador
- [Procedência](docs/procedencia.md): origem e integridade de cada versão
- [Licenciamento](docs/licenciamento.md): licenças do código, da documentação e da marca
- [Roadmap](docs/roadmap.md): objetivos de desenvolvimento

## Licença

Código próprio sob [Mozilla Public License 2.0](LICENSE). Documentação própria sob [CC BY 4.0](docs/LICENSE). Nome e logos Noisetupi: ver [TRADEMARKS.md](TRADEMARKS.md). Componentes de terceiros: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

© 2026 Noisetupi

---

## English summary

Laboratório Noisetupi is a browser-based creative suite for sound, motion images and printed zines, made by Noisetupi Produções Audiovisuais (Brazil) for workshops, schools and cultural institutions. The tools need no install and no login, and all media is processed on the user's device. Code is licensed under MPL-2.0 and documentation under CC BY 4.0; the Noisetupi name and logos are not covered by those licenses.
