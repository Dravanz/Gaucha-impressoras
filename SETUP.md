# Passo a passo para colocar no ar

Tempo estimado: 30 a 40 minutos, uma vez só (mais 15 minutos se quiser o e-mail automático).

## 1. Supabase (banco, login e imagens)

1. Crie uma conta em <https://supabase.com> e clique em **New project**.
   - Região: **South America (São Paulo)**.
   - Guarde a senha do banco num gerenciador de senhas (não vai no site).
2. Abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
   (Opcional: rode também `supabase/seed-exemplo.sql` para começar com 4 impressoras de exemplo.)
3. Ainda no SQL Editor, cadastre o dono como primeiro admin (troque o e-mail pelo Gmail dele):
   ```sql
   insert into public.equipe_admin (email, papel) values ('dono@gmail.com', 'admin');
   ```
   Para liberar outra pessoa só com acesso a impressoras/reservas: papel `gerente`.
4. **Desligue o login por e-mail/senha**: *Authentication → Sign In / Providers → Email* → desativar. Só o Google fica ligado.
5. Copie a **URL do projeto** (*Project Settings → Data API*, ou botão **Connect**) e a chave **publishable** (`sb_publishable_...`) em *Project Settings → API Keys*. Cole em `js/config.js` (`supabaseUrl` e `supabaseAnonKey`).
   > Nunca use a chave `secret` / `service_role` no site.

## 2. Google (login OAuth)

1. Acesse <https://console.cloud.google.com>, crie um projeto (ex.: "Gaúcha site").
2. **APIs e serviços → Tela de consentimento OAuth**: tipo *Externo*, preencha nome e e-mail de suporte. Pode deixar em **Testando** e adicionar em *Público → Usuários de teste* o e-mail Google de cada pessoa da equipe.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
   - *URIs de redirecionamento autorizados*: `https://SEU-PROJETO.supabase.co/auth/v1/callback`
4. Copie o **Client ID** e o **Client secret**.
5. No Supabase: *Authentication → Sign In / Providers → Google* → ative, cole os dois valores e salve.
6. No Supabase: *Authentication → URL Configuration*:
   - **Site URL**: `https://dravanz.github.io/Gaucha-impressoras/` (ou o domínio próprio)
   - **Redirect URLs**: `https://dravanz.github.io/Gaucha-impressoras/admin.html`
     (e `http://localhost:8080/admin.html` se for testar localmente)

## 3. GitHub Pages (site)

1. No repositório: *Settings → Pages → Build and deployment → Deploy from a branch* → `main` / `(root)`.
2. Em alguns minutos o site fica em `https://dravanz.github.io/Gaucha-impressoras/`.
3. **Keep-alive** (evita que o Supabase grátis pause por inatividade): *Settings → Secrets and variables → Actions → Variables* → crie `SUPABASE_URL` e `SUPABASE_ANON_KEY` com os mesmos valores do `js/config.js`.

### Domínio próprio (opcional)

Registre no Registro.br (ex.: `gauchaimpressoras.com.br`), crie um registro `CNAME` apontando para `dravanz.github.io`
e informe o domínio em *Settings → Pages → Custom domain* (marque **Enforce HTTPS**).
Depois atualize **Site URL** e **Redirect URLs** no Supabase e os links do `404.html`.

## 4. Primeiro acesso

1. Abra `/admin.html` e clique em **Entrar com Google** com o e-mail cadastrado no passo 1.3.
2. Na aba **Informações**, confira WhatsApp (`5553992023930`), endereço, e-mail e Instagram.
3. Na aba **Impressoras**, cadastre as impressoras com foto, valor por dia e descontos.
4. Os pedidos aparecem na aba **Reservas** com um contador. Aprove, recuse ou ajuste o valor; depois toque em **Avisar no WhatsApp**.

## 5. E-mail automático (opcional)

Sem isso tudo funciona: o dono é avisado pelo WhatsApp do cliente e avisa o cliente com um toque no painel.
Com isso, os e-mails saem sozinhos (novo pedido → dono; aprovado/recusado/cancelado → cliente; nova manutenção → dono).

Os e-mails saem pelo **Gmail da Gaúcha** (grátis, até ~500 por dia, sem precisar de domínio).

1. Na Conta Google do Gmail que vai enviar: *Segurança → Verificação em duas etapas* (ative, se ainda não estiver)
   → no fim da página, **Senhas de app** (ou acesse <https://myaccount.google.com/apppasswords>) → crie uma chamada "Site Gaúcha" e copie a senha de 16 letras.
2. No Supabase: *Edge Functions → Deploy a new function → Via Editor*, nome `notificar`,
   cole o conteúdo de `supabase/functions/notificar/index.ts` e faça o deploy
   (se a função já existe, abra *Code*, cole a versão nova e clique em **Deploy updates**).
   Em *Settings* da função, desligue **Verify JWT** (a função confere um segredo próprio).
3. *Edge Functions → Secrets*: crie `GMAIL_USUARIO` (o Gmail), `GMAIL_SENHA_APP` (a senha de app),
   `EMAIL_DONO` (quem recebe os avisos de novo pedido) e `WEBHOOK_SECRET` (uma senha longa qualquer).
   > Se um dia tiverem domínio próprio, dá para usar o Resend: apague os dois secrets do Gmail e crie `RESEND_API_KEY` e `EMAIL_REMETENTE`.
4. Ligue os avisos. Escolha **um** dos dois jeitos:
   - **Por SQL (mais fácil):** abra `supabase/webhooks.sql`, troque `TROQUE_PELO_WEBHOOK_SECRET` pelo mesmo valor do `WEBHOOK_SECRET` e rode no SQL Editor.
   - **Pela tela:** *Integrations → Database Webhooks* (se pedir, clique em **Enable webhooks**) → **Create a new hook**, duas vezes:
     tabela `reservas` (eventos Insert e Update) e tabela `chamados` (evento Insert); tipo **Supabase Edge Functions**, função `notificar`, método POST;
     em *HTTP Headers* adicione `x-webhook-secret` com o mesmo valor do `WEBHOOK_SECRET`.
5. Teste: faça um pedido de locação no site e veja se o e-mail chega no `EMAIL_DONO`.
   Se não chegar, veja *Edge Functions → notificar → Logs*.

## Limites do plano grátis (Supabase Free)

- 500 MB de banco e 1 GB de imagens (fotos otimizadas para ~150–300 KB).
- 5 GB de tráfego por mês.
- Pausa após 7 dias sem acesso (resolvido pelo keep-alive).
