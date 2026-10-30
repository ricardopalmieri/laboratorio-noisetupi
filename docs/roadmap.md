# Roadmap

## Operação sem rede

Hoje a suíte precisa de conexão para carregar. O objetivo é funcionar sem rede depois do primeiro acesso, em tablets e computadores modestos:

- Arquitetura offline comum às quatro ferramentas: service worker, Cache API, IndexedDB e OPFS.
- Pacote de projeto portátil que embale as mídias e reabra em outro dispositivo e navegador, sem servidor que guarde o conteúdo de quem cria.
- Modo de distribuição local para espaços sem internet.
- Matriz de compatibilidade com metas de carregamento, persistência, memória e tempo de exportação por aparelho e navegador.
- No Safari / iPadOS, dados de sites não instalados podem ser apagados após sete dias sem uso; a instalação como app e a exportação de projetos entram como resposta a isso.
- Zine Editor com fontes empacotadas localmente, sem depender do Google Fonts.

## Suíte

- NT Zine Editor no padrão do laboratório: revisão de bugs, tela de abertura, tokens de design e estrutura de projeto das outras ferramentas.
- Tokens de design unificados (cores, fontes, tela de abertura) entre as quatro ferramentas.
- Seletor de idioma português e inglês em todas as ferramentas, como já existe no Video Content Tool.
- Ponte entre ferramentas: áudio do Looper ou do Sampler abrindo direto no Video Content Tool, imagens do Video Content Tool indo para o Zine Editor.
- Testes automatizados no Sampler e no Zine Editor, no modelo do Video Content Tool.

## Histórico

Versões anteriores (Looper 1.x e 2.x, Sampler 2.x) podem entrar como tags, para registrar a evolução de cada ferramenta.
