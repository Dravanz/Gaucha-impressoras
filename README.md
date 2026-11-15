# Gaúcha Impressoras · site

Site da **Gaúcha Impressoras** (locação e manutenção de impressoras), com painel
administrativo para o dono cadastrar impressoras e aprovar as locações pelo celular.

- **Início** (`index.html`): apresentação, serviços, impressoras em destaque, como funciona e horário (com aviso "aberto agora / fechado").
- **Locação** (`locacao.html`): catálogo com foto, marca, recursos e valor por dia (com desconto e desconto para período longo). O cliente marca o período no calendário, vê o total na hora e envia o pedido. As datas ficam **pendentes** (bloqueadas para outros clientes) até o dono aprovar ou recusar.
- **Manutenção** (`manutencao.html`): formulário com modelo, foto opcional e descrição que abre o WhatsApp da Gaúcha (53 99202-3930) com a mensagem pronta.
- **Painel** (`admin.html`): login com Google, só para e-mails cadastrados no Supabase. Abas: Reservas (aprovar, recusar, ajustar valor/desconto, cancelar, avisar o cliente), Agenda (próximos 45 dias), Impressoras (cadastro/edição/foto/preço/descontos), Manutenção, Informações e Log.

Identidade "papel e tinta": fundo de papel, formulário contínuo, cupom fiscal e as cores da marca
(verde, amarelo e vermelho). Logo redesenhada em vetor em `img/logo.svg` (também `logo-horizontal.svg`,
`logo-simbolo.svg` e PNGs em alta resolução para redes sociais).

Mesma base do [blackwhite-site](https://github.com/Dravanz/blackwhite-site): HTML/CSS/JS estático no GitHub Pages + Supabase.

## Como funciona

| Parte | Serviço | Custo |
|---|---|---|
| Site (HTML/CSS/JS estático) | GitHub Pages | grátis |
| Banco, login (Google) e imagens | Supabase (plano Free) | grátis |
| E-mail automático (opcional) | Supabase Edge Function + Gmail (ou Resend com domínio) | grátis |

### Fluxo de uma locação

1. Cliente escolhe a impressora e marca o período. O banco calcula o valor e grava o pedido como **pendente**.
2. Uma restrição no próprio banco (`sem_conflito`) impede que dois pedidos pendentes/aprovados usem o mesmo dia da mesma impressora, mesmo que duas pessoas cliquem ao mesmo tempo.
3. O site abre o WhatsApp do cliente com a mensagem pronta para a Gaúcha (**aviso ao dono**). Com o e-mail automático configurado, o dono também recebe um e-mail.
4. No painel o dono **aprova** (pode aplicar desconto ou digitar o valor combinado) ou **recusa** (libera as datas).
5. O painel mostra o botão **Avisar no WhatsApp** (e **Enviar e-mail**, se o cliente informou) com a mensagem pronta para o cliente. Com o e-mail automático configurado, o cliente recebe o e-mail sozinho.

> Envio 100% automático pelo WhatsApp exige a API paga do WhatsApp Business. Por isso o aviso por WhatsApp é com um toque (mensagem pronta) e o automático é por e-mail.

## Segurança

- Login só via OAuth (Google), fluxo PKCE. Acesso ao painel só para e-mails da tabela `equipe_admin` (editada só pelo Supabase).
- Sessão de 15 minutos conferida no servidor (`papel_atual()`).
- Row Level Security em todas as tabelas. O visitante **não lê** reservas nem chamados: ele só cria pedidos pelas funções `solicitar_reserva` / `abrir_chamado` e vê as datas ocupadas por `datas_ocupadas` (sem dados pessoais).
- No painel, a equipe só consegue alterar status, valor final e resposta de uma reserva (datas e valores do pedido não podem ser trocados).
- Uploads: só imagens até 3 MB; visitantes só na pasta `manutencao/`. Fotos convertidas para WebP no navegador (remove GPS/EXIF).
- Sem XSS (texto entra com `textContent`), Content Security Policy restritiva, painel com `noindex`.
- Log de alterações gravado pelo banco (quem, IP, quando e o que mudou), visível só para o admin.

## Rodar localmente

Sem configurar o Supabase o site abre em **modo demonstração** com impressoras e reservas de exemplo.
O painel de demonstração fica em `admin.html?demo`.

```bash
npx serve .        # ou: python3 -m http.server 8080
```

## Colocar no ar

Siga o passo a passo em [SETUP.md](SETUP.md).

## Estrutura

```
index.html  locacao.html  manutencao.html  admin.html  404.html
css/styles.css   css/admin.css
js/config.js   ← URL e chave publishable do Supabase, WhatsApp, horário
js/site.js     ← site público (catálogo, calendário, manutenção)
js/admin.js    ← painel
js/demo.js     ← conteúdo de exemplo (modo demonstração)
js/vendor/supabase.js
img/logo*.svg|png   img/impressoras/*.svg (ilustrações de exemplo)
supabase/schema.sql          ← tabelas, regras de segurança, funções e bucket
supabase/seed-exemplo.sql    ← impressoras de exemplo (opcional)
supabase/functions/notificar ← e-mail automático pelo Gmail (opcional)
supabase/webhooks.sql        ← liga a função nas tabelas
.github/workflows/supabase-keepalive.yml
```
