# Tutor SNC — Criador de Tutoriais Interativos

Ferramenta local (roda 100% no navegador, sem backend) para criar tutoriais
passo a passo a partir de prints de sistemas — com destaque animado, balão de
instrução, e exportação em HTML interativo, PDF, GIF ou vídeo WebM.

Desenvolvido por Fagner.

## Agentes do Claude Code

O projeto já vem com 6 subagentes prontos em `.claude/agents/`, pensados
pra você delegar o trabalho em vez de fazer tudo numa conversa só:

| Agente | Quando ele entra em ação |
|---|---|
| `coordinator` | Ponto de entrada padrão — recebe o pedido, decide quem chamar, revisa o resultado, atualiza o changelog |
| `ui-design` | Cor, tema, layout, espaçamento, animação — só `css/styles.css` |
| `editor-engineer` | Editor, árvore de telas, hotspots, State/Persist, telas do dashboard — em `js/app.js` |
| `export-engineer` | Player de visualização + exportação HTML/PDF/GIF/Vídeo — em `js/app.js` |
| `studio-engineer` | Estúdio: captura de tela, webcam, áudio, editor de vídeo, extensões — em `js/studio.js` |
| `qa-engineer` | Reproduz bugs, testa fluxo completo, valida correções antes de aprovar |

**Como usar:** basta pedir a mudança normalmente (ex: "muda a cor do botão
primário para verde" ou "o GIF não está exportando") — o Claude Code lê a
`description` de cada agente e delega automaticamente pro especialista
certo. Se quiser forçar um agente específico, chame explicitamente:
`Use o agente qa-engineer para testar a exportação de vídeo`.

O `coordinator` é quem amarra tudo: ele sabe que uma mudança visual grande
pode exigir `ui-design` + depois `qa-engineer` validando, por exemplo — e
é ele quem garante que o `BUILD_ID` em `js/app.js` sobe e o changelog deste
README é atualizado a cada entrega real.

## Estrutura do projeto

```
tutor-snc/
├── index.html      → estrutura da página, menu agrupado, modais e as libs externas (jsPDF, gif.js)
├── css/
│   └── styles.css  → design system (tokens, temas, componentes) + estilos v4 (menu, estúdio, extensões)
├── js/
│   ├── app.js      → estado, persistência, views, editor, player, exportação, projetos, atalhos, i18n
│   └── studio.js   → ESTÚDIO: captura de tela, webcam, áudio, editor de vídeo, extensões
├── tests/          → testes de ponta a ponta (Playwright): npm test
├── electron/       → casca de desktop opcional (npm run desktop)
├── biome.json      → regras de lint (npm run lint)
└── .claude/agents/ → os 6 subagentes descritos acima
```

## Menu (onde fica cada coisa)

| Grupo | Item | Para quê |
|---|---|---|
| Início | Dashboard | Resumo, atalhos e o guia "onde fica cada coisa" |
| Tutoriais | Meus tutoriais | Criar, abrir e excluir tutoriais |
| Tutoriais | Biblioteca | Estilos de destaque e elementos livres (cursor, seta, clique, balão, tecla, botão, texto, número, imagem) |
| Publicar | Exportar | Qualidade, proporção, moldura, animação (vale para PDF/GIF/Vídeo/HTML), prévia ao vivo e predefinições |
| Publicar | Projetos e backup | Salvar tutorial em `.tutor.json` e abrir em outro computador |
| **Estúdio · mídia** | Captura de tela | Gravar a tela (com webcam, microfone e moldura) ou tirar um print |
| **Estúdio · mídia** | Webcam | Formato, canto, tamanho; gravar só a webcam |
| **Estúdio · mídia** | Editor de vídeo | Cortar, velocidade, zoom, texto, narração extra, moldura, exportar WebM, quadro → tutorial |
| **Estúdio · mídia** | Áudio | Gravar narração (medidor de nível) |
| **Estúdio · mídia** | Extensões | Molduras, predefinições, painel de opções e marca d'água (arquivos JSON, sem executar código) |
| Sistema | Atalhos | Teclas rápidas editáveis |
| Sistema | Configurações | Tema, cor, idioma (PT/EN/ES), armazenamento |

O app não tem build step — é HTML/CSS/JS puro. Basta abrir `index.html`
diretamente no navegador, ou servir a pasta com um servidor local (recomendado
para evitar avisos de segurança do Chrome com `file://`):

```bash
npx serve .
# ou
python3 -m http.server 8080
```

## Arquitetura do `js/app.js`

Como é um único arquivo sem módulos ES (`type="module"`), tudo vive no escopo
global do script, nesta ordem (importa manter a ordem se for dividir mais):

1. **BUILD_ID** — marcador de versão, logado no console e mostrado em
   Configurações → Sobre. Sempre incremente ao fazer uma mudança, ajuda a
   confirmar qual versão está rodando durante testes.
2. **State** — objeto único com todo o estado da aplicação (tutoriais, tema,
   accent color, estilo padrão de hotspot, estado do editor).
3. **Persist** — camada de localStorage, **dividida em duas chaves**:
   - `looptour_settings_v1` — tema, accent, estilo padrão (pequeno, sempre salva)
   - `looptour_data_v1` — tutoriais com imagens em base64 (pode estourar a
     cota do navegador; falha graciosamente com um toast avisando o usuário)
4. **App / Views / Settings / Templates** — telas do dashboard (Dashboard,
   Meus Tutoriais, Templates, Biblioteca, Exportações, Configurações).
5. **Editor** — o editor full-screen: árvore de telas, canvas de desenho de
   hotspots, inspector (aba Passo / Estilo / IA), timeline inferior.
6. **Player** — modo de visualização do tutorial (spotlight, tooltip, hotspots
   animados, navegação por teclado).
7. **Exportação** — `renderStepToCanvas()` desenha cada passo num `<canvas>`
   (usado por PDF/GIF/Vídeo); `buildExportHTML()` gera o tutorial standalone
   em HTML; GIF usa `gif.js` com worker via Blob URL; vídeo usa
   `MediaRecorder` + `canvas.captureStream()`.

## Arquitetura do `js/studio.js` (carrega depois de `app.js`)

`MediaStore` (IndexedDB, gravações) · `Ticker` (Worker que não "dorme" em aba
oculta) · `StudioCfg` (opções do estúdio) · `Extensions` / `ExtUI` ·
`Capture` · `WebcamView` · `AudioView` · `VE` (editor de vídeo) · `RecBar`
(indicador flutuante de gravação, visível em qualquer tela). Usa
`paintFrameBackground`, `frameGeometry`, `renderStepToCanvas`-helpers e
`ExportOpts` de `app.js`, então molduras/proporção valem igual para tutorial e vídeo.

**Extensões são declarativas**: o sistema valida o JSON (`Extensions.validate`)
e só aceita `frames`, `presets`, `settings` e `watermark`. Nunca execute código
vindo de um arquivo de extensão.

## Decisões importantes (não reverter sem motivo)

- **Caminho de recorte `evenodd` usa `roundRectSub`, não `roundRectPath`** —
  `roundRectPath` chama `beginPath()` e apagava o retângulo externo, então
  (até a v3.12) o escurecimento de GIF/Vídeo caía *dentro* do destaque em vez
  de ao redor. Qualquer cutout novo deve usar `roundRectSub`.
- **Zoom por passo (`step.zoom`)** existe em 3 implementações que precisam
  ficar iguais: `Player.position` (CSS transform no `#player-img`),
  `stepZoomTarget`/`renderStepToCanvas` (Canvas, com recorte na tela) e o motor
  `Tour` do HTML exportado. PDF ignora o zoom de propósito (manual impresso).
- **Cursor animado**: `Player.moveCursor`, `renderStepToCanvas` (parâmetro
  `anim`) e `moveCursor` do `Tour` exportado.
- **Envio de prints**: o `change` do `#file-input` tem listener fixo (não é mais
  atribuído dentro de `Editor.upload()`), para funcionar também quando o seletor
  é acionado por automação ou arrastar/soltar.
- **Importação de projeto valida tudo** (`Projects.importData`): só aceita
  `data:image/`, limita tamanhos de texto, usa listas de valores permitidos e
  gera ids novos. Não relaxe isso.
- **Atalhos**: ações vivem em `Shortcuts.defs`; novas teclas entram ali (a tela
  Atalhos se monta sozinha). Os atalhos do editor ficam desligados com o
  Visualizar ou algum modal aberto.



- **Nunca declare uma variável chamada `stage` duas vezes na mesma função** —
  já causou um bug real de "Cannot access 'stage' before initialization"
  (temporal dead zone). O elemento do canvas principal é sempre acessado via
  `document.getElementById('stage')`, com nomes diferentes por escopo
  (`stageEl` no bloco de drag-to-draw).
- **Toda exportação (PDF/GIF/Vídeo) precisa checar `steps.length === 0`
  antes de prosseguir** — sem isso, o GIF trava para sempre e o vídeo quebra
  tentando ler propriedades de `undefined`.
- **Downloads sempre anexam o `<a>` ao DOM antes de `.click()`** — em páginas
  `file://`, um link solto (não anexado) dispara um aviso de navegação
  insegura no console e pode falhar silenciosamente.
- **Tema/accent/estilo padrão vivem numa chave separada dos dados dos
  tutoriais** — para que uma falha de cota de armazenamento (imagens grandes)
  nunca impeça salvar preferências simples.
- **Arrastar/redimensionar hotspot usa listeners de `document`, não do
  elemento** — `mousemove`/`mouseup` são adicionados a `document` (não ao
  `div` do hotspot) durante o drag, e removidos no `mouseup`. Isso evita
  perder o movimento se o cursor sair da área do hotspot durante o arrasto.
- **`renderStepToCanvas` é a única fonte visual compartilhada por PDF/GIF/
  Vídeo** — qualquer elemento novo que deva aparecer nesses 3 formatos (como
  o badge de marca) entra ali, não duplicado em cada `run*`. Já o HTML
  exportado (`buildExportHTML`) é um template separado e precisa da mesma
  mudança replicada manualmente nele.
- **Qualquer handler de mousedown num elemento dentro do `#stage` precisa
  checar `State.editor.drawMode` no início, antes de `stopPropagation()`**
  — senão ele "sequestra" o clique de quem está tentando desenhar uma nova
  área por cima/perto de um hotspot já existente (foi exatamente o bug do
  `resizeMouseDown` na v3.8, que faltava esse guard enquanto
  `hotspotMouseDown` já tinha).
- **`renderStepToCanvas` tem um parâmetro `theme` opcional** (`'dark'`
  padrão, `'light'` usado só pelo PDF) — não assuma fundo escuro fixo ao
  adicionar elementos novos nessa função; considere como cada um se
  comporta nos dois temas.
- **A CSS de animação dos hotspots existe em dois lugares que já ficaram
  fora de sincronia uma vez (v3.11)**: `.player-hotspot.*` no stylesheet
  principal (usado pelo `Player` interno) e a cópia dentro do template de
  `buildExportHTML` (usado pelo motor `Tour` do arquivo exportado, com
  cores hardcoded em vez de `var(--accent)` porque é um HTML standalone
  sem acesso às variáveis do app). Sempre que adicionar/mudar um estilo de
  hotspot, edite os dois. O mesmo vale para a lógica JS de redimensionar o
  estilo "Ponto" (`Player.position()` vs. o `pos()` dentro do `Tour`).
- **Anotações livres (`sc.annotations[]`) são renderizadas em 4 lugares
  independentes** que precisam ficar sincronizados manualmente: o canvas
  do editor (`Editor.renderCanvas`, DOM+SVG), o Player interno
  (`Player.position`, DOM+SVG viewport-relativo), o Canvas 2D compartilhado
  por PDF/GIF/Vídeo (`drawAnnotationOnCanvas`), e o motor `Tour` dentro do
  HTML standalone exportado (`buildExportHTML`, JS vanilla isolado —
  **não pode usar backtick** dentro dessa string porque ela já está dentro
  de um template literal externo; use concatenação com `+`). Ao adicionar
  um novo tipo de elemento, atualize os 4 lugares — não existe uma fonte
  única de verdade como acontece com `renderStepToCanvas` para hotspots.
- **Texto de balão/tecla/botão usa `prompt()` nativo**, não um formulário
  inline — foi uma simplificação deliberada dado o escopo. Uma melhoria
  futura razoável é trocar por um popover inline consistente com o resto
  do design system.

## Changelog

- **v4.0** — Estúdio + exportação profissional + projetos (a partir das ideias do
  Recordly; só ideias, nenhum código copiado — a licença dele é AGPL-3.0):
  1. **Menu reorganizado em grupos** (Início, Tutoriais, Publicar, Estúdio · mídia,
     Sistema), cada item com uma linha dizendo o que faz; guia no Dashboard.
  2. **Estúdio** (seção separada): captura de tela/print, webcam, áudio, editor de
     vídeo, extensões. Gravações ficam no IndexedDB do navegador.
  3. **Exportação**: qualidade, proporção (16:9, 4:3, 1:1, 9:16), moldura/fundo,
     espaçamento, cantos, sombra, fps e loop do GIF, predefinições; tela "Exportar"
     com prévia ao vivo e histórico.
  4. **GIF/Vídeo animados**: destaque pulsando, zoom suave, cursor que vai ao
     destaque e "clica", balão com fade. Opção de manter estático.
  5. **Zoom por passo** (1,5×, 2×, 3×) no Visualizar, HTML exportado e GIF/Vídeo.
  6. **Cursor animado** no Visualizar e no HTML exportado.
  7. **Projetos**: salvar/abrir `.tutor.json` (inclui anotações, marca e zoom; o
     backup antigo perdia anotações e marca).
  8. **Atalhos editáveis** + tela de referência.
  9. **Novos elementos livres**: Texto, Número e Imagem (nos 4 lugares de render).
  10. **Idiomas** PT/EN/ES para menu, títulos e exportação (o editor interno segue em PT).
  11. **Testes** (Playwright, 59 verificações), lint (Biome) e casca **Electron**.
  - **Bugs corrigidos no caminho**: escurecimento de GIF/Vídeo caía dentro do
    destaque (ver "Decisões"); `Editor.upload()` só ligava o `onchange` ao clicar
    no botão; emoji no onboarding; PDF esticava a imagem (agora respeita a proporção).
  - **Limitações conhecidas**: gravar com webcam/moldura combina os quadros numa aba
    do navegador (mantenha a aba aberta); captura de tela/áudio exigem HTTPS ou
    localhost; vídeo editado exporta em tempo real (WebM, sem MP4); o Electron
    não foi testado no ambiente de desenvolvimento.

- **v3.12** — Lote de correções e melhorias a partir de dois relatórios de
  QA (um deles gerado por Cowork/Haiku 4.5):
  1. **Tooltip no título do editor** — campo de nome do tutorial truncava
     sem forma de ver o texto completo; agora tem `title` attribute nativo.
  2. **Renomear telas** — antes fixas em "Tela 1", "Tela 2"... Agora
     duplo-clique no nome (sidebar) abre edição inline; nome customizado
     (`sc.customName`) persiste e aparece também na timeline.
  3. **Desfazer (Ctrl/Cmd+Z)** — undo de um nível para a última exclusão
     (passo, tela ou elemento livre), via `State.editor.lastDeleted` +
     `Editor.undo()`. Não é um histórico completo — só a última exclusão.
  4. **Delete/Backspace** remove o passo selecionado (com a mesma
     confirmação de sempre); **setas do teclado** movem o passo
     selecionado em incrementos pequenos (Shift = incremento maior).
     Atalhos são ignorados enquanto o foco está num campo de texto.
  5. **Zoom no canvas** — Ctrl/Cmd+scroll, e um controle flutuante
     (−/100%/+) no canto inferior esquerdo. Implementado via
     `transform:scale()` no `#stage-wrap`; a matemática de desenho de
     hotspot/anotação não precisou mudar porque `getBoundingClientRect()`
     já reflete o elemento escalado automaticamente.
  6. **Modal de onboarding** — aparece uma única vez, na primeira vez que
     o editor é aberto (flag `hasSeenOnboarding` na chave de configurações).
     4 dicas rápidas: desenhar área, aba Estilo, Visualizar, Exportar.
  7. **Preview animado de verdade nos "Estilos de destaque"** — os ícones
     de Pulso/Brilho/Ripple/Ponto/Anel/Simples na aba Estilo e na Biblioteca
     agora animam de verdade (usando `<animate>` SVG nativo, sem depender
     de CSS externo), então dá pra ver o efeito antes de escolher.
  - **Investigado e descartado como falso positivo**: dois relatórios
    reportaram "Enviar print"/"Adicionar tela" como não-funcionais. Todos
    os 5 pontos de entrada do app chamam corretamente `Editor.upload()` →
    `input[type=file].click()` — o padrão correto e único de abrir o
    seletor de arquivos do SO em HTML puro. A explicação mais provável é
    que ferramentas de teste agêntico/headless não conseguem ver ou
    interagir com o diálogo nativo do sistema operacional (ele existe fora
    do DOM/árvore de acessibilidade da página), então parece que "nada
    aconteceu" mesmo quando o clique disparou corretamente. Peça para um
    humano confirmar manualmente antes de mexer nisso de novo.
  - **Decisão consciente, não implementada**: nome de tutorial vazio
    continua caindo em "Tutorial sem nome" (como Word/Notion/Google Docs
    fazem) em vez de bloquear com erro de validação — é uma escolha de UX
    deliberada, não uma falha de validação esquecida.
- **v3.11** — Estilos de destaque, parte 2:
  1. Implementadas animações reais para **Anel** (um único anel expandindo
     e sumindo, mais discreto que o Pulso que usa dois anéis) e **Simples**
     (uma "respiração" sutil de sombra, intencionalmente discreta).
  2. Achado e corrigido um bug maior enquanto mexia nisso: o **HTML
     standalone exportado só tinha CSS para Pulso e Brilho** — Ripple,
     Ponto, Anel e Simples nunca funcionaram no arquivo exportado, só no
     preview interno do app (`Player`). Adicionadas as 4 animações que
     faltavam no template de `buildExportHTML`.
  3. Também faltava no exportado a lógica que encolhe o hotspot "Ponto"
     para um círculo pequeno centralizado — sem ela, "Ponto" virava uma
     oval esticada do tamanho do retângulo inteiro. Corrigido.
  - **Limitação que continua existindo (não é regressão, é arquitetura)**:
    as animações de hotspot só aparecem no Player (Visualizar) e no HTML
    exportado — GIF, Vídeo e PDF renderizam um frame estático por passo via
    `renderStepToCanvas`, que não lê `hotspotStyle` (só desenha a borda de
    destaque, sempre igual). Isso é esperado para PDF; para GIF/Vídeo seria
    uma melhoria futura renderizar múltiplos frames por passo para simular
    a animação.
- **v3.10** — Removida a funcionalidade de Templates por completo: item da
  sidebar, `Views.templates()`, `TEMPLATE_LIST`, o objeto `Templates`, e o
  CSS órfão (`.template-card` etc). Não sobrou nenhuma referência no código.
- **v3.9** — Implementados de verdade os "Componentes" da Biblioteca:
  cursor, seta, clique, balão, tecla e botão agora são **elementos livres**
  que você posiciona em qualquer lugar da tela, sem virar um "passo"
  numerado. Novo modelo de dados `sc.annotations[]` por tela (paralelo a
  `sc.steps[]`). Barra de ferramentas nova no canto do canvas do editor
  (visível só quando há uma tela ativa) — clique num ícone, depois clique
  (ou arraste, no caso da seta) na imagem para posicionar. Elementos podem
  ser arrastados para mover e têm botão "×" para excluir; balão/tecla/botão
  usam `prompt()` nativo pra digitar o texto (simplificação deliberada, ver
  nota abaixo). Renderizado em **todos os lugares**: canvas do editor,
  Player (Visualizar), e as 4 exportações (HTML/PDF/GIF/Vídeo) — cada
  contexto tem sua própria rotina de desenho (DOM+SVG no editor/Player/HTML
  exportado, Canvas 2D em `drawAnnotationOnCanvas` para PDF/GIF/Vídeo). A
  página Biblioteca agora é uma vitrine/atalho: clicar num componente abre
  o tutorial mais recente e já entra no modo de posicionar aquele elemento.
- **v3.8** — 2 correções:
  1. Corrigido conflito ao adicionar múltiplos passos na mesma tela: as
     alças de redimensionamento do hotspot já selecionado podiam "roubar"
     o clique quando se tentava desenhar uma nova área por perto
     (`resizeMouseDown` não checava `State.editor.drawMode`, diferente de
     `hotspotMouseDown`). Também adicionado um botão flutuante "Novo passo"
     sempre visível no canvas, para não depender só do duplo-clique
     (pouco descobrível) para adicionar um segundo hotspot.
  2. PDF exportava com fundo preto/cinematográfico (igual GIF/Vídeo), ruim
     para impressão. `renderStepToCanvas` agora aceita um parâmetro
     `theme` ('dark' padrão para GIF/Vídeo, 'light' para PDF) — no modo
     light usa fundo branco/cinza claro, remove o overlay escuro de
     destaque (spotlight) e usa um preenchimento sutil azul + borda de
     destaque, mais adequado para impressão.
- **v3.7** — Lote de 8 correções/melhorias:
  1. Posição do balão agora dá feedback visual (pill ativa) ao clicar.
  2. Área de marcação (hotspot) pode ser **movida** (arrastar depois de
     selecionada) e **redimensionada** (alças nos 4 cantos), sem precisar
     redesenhar do zero — `Editor.hotspotMouseDown` / `Editor.resizeMouseDown`.
  3. Aba "Estilo" agora funciona também para um passo ainda não salvo
     (hotspot recém-desenhado, antes de clicar em "Adicionar passo").
  4. Removida a aba/botão "IA" (era só um placeholder que não gerava nada real).
  5. Adicionado campo de **marca por tutorial** (nome + logo, botão "Marca"
     na topbar do editor) — aparece em **todos** os formatos de exportação:
     HTML (start-card + cabeçalho do player), PDF, GIF e Vídeo (badge no
     canto superior esquerdo de cada frame, via `renderStepToCanvas`).
  6. Rebrand de "Tutor IA" para "Tutor SNC".
  7. Removido o rodapé de usuário (avatar/nome/plano) na sidebar — agora
     mostra só "Desenvolvido por Fagner Silva".
  8. Adicionado botão de excluir tutorial nos cards de "Meus Tutoriais" e
     do Dashboard (a função já existia no código, só não estava ligada a
     nenhum botão visível).
- **v3.6** — Adicionado crédito "Desenvolvido por Fagner" em Configurações → Sobre.
- **v3.5** — Rebrand de "Loop" para "Tutor IA" em todos os textos visíveis.
- **v3.4** — Templates da Biblioteca agora criam um tutorial nomeado de verdade
  e abrem o editor, em vez de só mostrar um toast de "em breve".
- **v3.3** — Cards de "Estilos de destaque" na Biblioteca agora são clicáveis:
  definem o estilo padrão de hotspot para novos passos, com persistência.
- **v3.2** — Corrigido aviso "Unsafe attempt to load URL... file: URLs..." ao
  baixar arquivos — downloads agora anexam o link ao DOM antes do clique.
- **v3.1** — Corrigido bug crítico "Cannot access 'stage' before
  initialization" que impedia criar qualquer passo/hotspot (variável
  redeclarada no mesmo escopo). Renomeada para `stageEl` por segurança extra.
  Adicionados guards de "zero passos" em PDF/GIF/Vídeo (o GIF travava para
  sempre e o vídeo quebrava com esses dados vazios). Separada a persistência
  de configurações (tema/accent) dos dados de tutoriais, corrigindo a cor de
  destaque não persistir quando o localStorage estourava a cota com imagens
  grandes. Adicionado botão de excluir tela na árvore lateral (não existia).
- **v3.0** — Reformulação completa: app shell com Dashboard, Meus Tutoriais,
  Templates, Biblioteca, Exportações e Configurações. Editor redesenhado
  (árvore de telas estilo Figma, timeline, inspector com abas). Hotspots
  animados (pulse/glow/ripple/dot/ring/simple). Player premium com
  backdrop-blur, barra de progresso, navegação por teclado. Temas claro/escuro
  + 5 accent colors. Placeholder honesto de "Gerar Tutorial com IA".
- **v2** — Exportação em PDF, GIF e Vídeo WebM adicionadas (além do HTML
  interativo já existente), tudo renderizado localmente via `<canvas>`.
- **v1** — Versão inicial: upload de print, desenho de área de destaque
  (hotspot), formulário de passo, player com spotlight + tooltip, exportação
  em HTML standalone.

## Ideias futuras (não implementadas)

- IA real analisando os prints (hoje o botão "Gerar rascunho" só infere a
  partir da posição/tamanho do hotspot, é um placeholder honesto)
- MP4 nativo (hoje exporta WebM; MP4 precisaria de FFmpeg.wasm ou conversão externa)
- Compartilhamento via link/embed real (hoje só download local)
- Reordenar telas/passos por drag-and-drop
- Zoom/pan no canvas do editor
- Colar print direto da área de transferência (Ctrl+V)
