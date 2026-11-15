-- =====================================================================
--  Gaúcha Impressoras — estrutura do banco (Supabase / Postgres)
--  Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
--  Pode rodar de novo sem problema (é idempotente).
-- =====================================================================

create extension if not exists btree_gist;   -- impede reservas com datas sobrepostas

-- ---------------------------------------------------------------------
-- 1. Equipe com acesso ao painel (lista de e-mails)
--    Só quem estiver aqui consegue alterar alguma coisa, mesmo logado.
--    Essa tabela só pode ser editada pelo próprio Supabase (Table Editor).
-- ---------------------------------------------------------------------
create table if not exists public.equipe_admin (
  email      text primary key check (email = lower(email) and email like '%@%'),
  papel      text not null default 'gerente' check (papel in ('admin', 'gerente')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Regra central de segurança
--    Libera escrita só se:
--      a) o e-mail do login está na equipe e ativo;
--      b) o e-mail foi verificado pelo provedor (Google);
--      c) a sessão foi criada há menos de 15 minutos (conferido no banco).
-- ---------------------------------------------------------------------
create or replace function public.papel_atual()
returns text
language sql stable security definer set search_path = ''
as $$
  select a.papel
  from public.equipe_admin a
  where a.ativo
    and a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false)
    and exists (
      select 1 from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and s.created_at > now() - interval '15 minutes'
    )
  limit 1;
$$;

create or replace function public.pode_editar()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.papel_atual() in ('admin', 'gerente'), false); $$;

create or replace function public.e_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.papel_atual() = 'admin', false); $$;

revoke all on function public.papel_atual() from public;
grant execute on function public.papel_atual(), public.pode_editar(), public.e_admin() to anon, authenticated;

-- Usada pelo painel para saber se o usuário logado tem acesso e quanto tempo resta.
create or replace function public.minha_sessao()
returns table (papel text, expira_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  select public.papel_atual(),
         (select s.created_at + interval '15 minutes' from auth.sessions s
           where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = auth.uid());
$$;
revoke all on function public.minha_sessao() from public, anon;
grant execute on function public.minha_sessao() to authenticated;

-- "Hoje" no horário de Brasília
create or replace function public.hoje()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Sao_Paulo')::date; $$;

-- ---------------------------------------------------------------------
-- 3. Impressoras para locação
-- ---------------------------------------------------------------------
create table if not exists public.impressoras (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null check (char_length(nome) between 2 and 80),
  marca              text not null default '' check (char_length(marca) <= 40),
  modelo             text not null default '' check (char_length(modelo) <= 60),
  categoria          text not null default 'Multifuncional' check (char_length(categoria) between 2 and 40),
  descricao          text not null default '' check (char_length(descricao) <= 600),
  recursos           text[] not null default '{}' check (cardinality(recursos) <= 12),
  foto               text check (foto is null or char_length(foto) <= 300),
  preco_dia          numeric(8,2) not null check (preco_dia >= 0 and preco_dia < 100000),
  desconto_pct       int not null default 0 check (desconto_pct between 0 and 90),
  desconto_longo_dias int check (desconto_longo_dias is null or desconto_longo_dias between 2 and 365),
  desconto_longo_pct int not null default 0 check (desconto_longo_pct between 0 and 90),
  minimo_dias        int not null default 1 check (minimo_dias between 1 and 60),
  destaque           boolean not null default false,
  ordem              int not null default 0,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

-- Valor de um período: preço/dia com desconto da impressora e,
-- se o período for longo, o desconto extra de período longo.
create or replace function public.valor_periodo(p public.impressoras, dias int)
returns numeric language sql immutable set search_path = ''
as $$
  select round(
    p.preco_dia * (1 - p.desconto_pct / 100.0) * dias
    * case when p.desconto_longo_dias is not null and dias >= p.desconto_longo_dias
           then 1 - p.desconto_longo_pct / 100.0 else 1 end, 2);
$$;

-- ---------------------------------------------------------------------
-- 4. Reservas (pedidos de locação)
--    pendente  -> bloqueia as datas e espera o dono decidir
--    aprovada  -> datas confirmadas
--    recusada / cancelada -> libera as datas
--    A restrição "sem_conflito" garante no próprio banco que duas
--    reservas pendentes/aprovadas nunca se sobrepõem na mesma impressora.
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo ~ '^GI-[A-Z0-9]{6}$'),
  impressora_id   uuid references public.impressoras (id) on delete set null,
  impressora_nome text not null default '' check (char_length(impressora_nome) <= 120),
  nome            text not null check (char_length(nome) between 2 and 80),
  telefone        text not null check (telefone ~ '^\d{12,13}$'),
  email           text check (email is null or (char_length(email) <= 120 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  empresa         text not null default '' check (char_length(empresa) <= 80),
  observacao      text not null default '' check (char_length(observacao) <= 500),
  inicio          date not null,
  fim             date not null,
  dias            int generated always as (fim - inicio + 1) stored,
  valor_estimado  numeric(10,2) not null check (valor_estimado >= 0),
  valor_final     numeric(10,2) check (valor_final is null or (valor_final >= 0 and valor_final < 10000000)),
  status          text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  resposta        text not null default '' check (char_length(resposta) <= 300),
  decidido_em     timestamptz,
  decidido_por    text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (fim >= inicio and fim - inicio < 366)
);
create index if not exists reservas_status on public.reservas (status, inicio);
do $$ begin
  alter table public.reservas add constraint sem_conflito
    exclude using gist (impressora_id with =, daterange(inicio, fim, '[]') with &&)
    where (status in ('pendente', 'aprovada'));
exception when duplicate_object or duplicate_table then null; end $$;

-- Registra quem decidiu e quando
create or replace function public.reserva_decisao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.decidido_em := now();
    new.decidido_por := coalesce(auth.jwt() ->> 'email', 'Supabase');
  end if;
  -- campos que o painel não pode trocar
  new.codigo := old.codigo; new.criado_em := old.criado_em;
  return new;
end $$;
drop trigger if exists trg_decisao on public.reservas;
create trigger trg_decisao before update on public.reservas
  for each row execute function public.reserva_decisao();

-- ---------------------------------------------------------------------
-- 5. Chamados de manutenção (protocolos)
--    pendente -> aguardando a Gaúcha analisar
--    aceita / recusada -> decisão (o cliente é avisado)
--    concluida -> serviço terminado
-- ---------------------------------------------------------------------
create table if not exists public.chamados (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^GM-[A-Z0-9]{6}$'),
  nome        text not null check (char_length(nome) between 2 and 80),
  telefone    text not null check (telefone ~ '^\d{12,13}$'),
  modelo      text not null check (char_length(modelo) between 2 and 80),
  descricao   text not null check (char_length(descricao) between 5 and 1000),
  email       text check (email is null or (char_length(email) <= 120 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  foto        text check (foto is null or foto ~ '^manutencao/[A-Za-z0-9-]+\.webp$'),
  status      text not null default 'pendente',
  resposta    text not null default '' check (char_length(resposta) <= 500),
  nota        text not null default '' check (char_length(nota) <= 500),
  decidido_em timestamptz,
  decidido_por text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Atualização de quem já tinha rodado a versão anterior (pode rodar de novo)
alter table public.chamados add column if not exists email text check (email is null or (char_length(email) <= 120 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'));
alter table public.chamados add column if not exists resposta text not null default '' check (char_length(resposta) <= 500);
alter table public.chamados add column if not exists decidido_em timestamptz;
alter table public.chamados add column if not exists decidido_por text;
alter table public.chamados drop constraint if exists chamados_status_check;
update public.chamados set status = case status when 'aberto' then 'pendente' when 'em_andamento' then 'aceita' when 'concluido' then 'concluida' else status end
  where status in ('aberto', 'em_andamento', 'concluido');
alter table public.chamados alter column status set default 'pendente';
alter table public.chamados add constraint chamados_status_check check (status in ('pendente', 'aceita', 'recusada', 'concluida'));

create or replace function public.chamado_decisao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.decidido_em := now();
    new.decidido_por := coalesce(auth.jwt() ->> 'email', 'Supabase');
  end if;
  return new;
end $$;
drop trigger if exists trg_decisao on public.chamados;
create trigger trg_decisao before update on public.chamados
  for each row execute function public.chamado_decisao();

-- Informações gerais (WhatsApp, e-mail, endereço...) — uma linha por chave.
create table if not exists public.config (
  chave  text primary key check (chave ~ '^[a-z_]{2,40}$'),
  valor  text not null default '' check (char_length(valor) <= 500)
);

-- Atualiza "atualizado_em" sozinho
create or replace function public.tocar_atualizado()
returns trigger language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['impressoras','reservas','chamados'] loop
    execute format('drop trigger if exists trg_atualizado on public.%I', t);
    execute format('create trigger trg_atualizado before update on public.%I
                    for each row execute function public.tocar_atualizado()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Funções públicas usadas pelo site (o visitante nunca lê as tabelas
--    de reservas/chamados direto, então ninguém vê dados de clientes)
-- ---------------------------------------------------------------------

-- Datas ocupadas (pendentes e aprovadas) de hoje em diante. Sem dados pessoais.
create or replace function public.datas_ocupadas(p_impressora uuid default null)
returns table (impressora_id uuid, inicio date, fim date, status text)
language sql stable security definer set search_path = ''
as $$
  select r.impressora_id, r.inicio, r.fim, r.status
  from public.reservas r
  join public.impressoras i on i.id = r.impressora_id and i.ativo
  where r.status in ('pendente', 'aprovada')
    and r.fim >= public.hoje()
    and (p_impressora is null or r.impressora_id = p_impressora)
  order by r.inicio;
$$;

create or replace function public.novo_codigo(prefixo text)
returns text language sql volatile set search_path = ''
as $$
  select prefixo || '-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create or replace function public.so_digitos_fone(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when length(d) in (10, 11) then '55' || d else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Pedido de locação feito pelo site. O valor é calculado aqui, no banco.
create or replace function public.solicitar_reserva(
  p_impressora uuid, p_inicio date, p_fim date,
  p_nome text, p_telefone text, p_email text default null,
  p_empresa text default '', p_observacao text default '')
returns table (codigo text, dias int, valor numeric, impressora text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  imp public.impressoras;
  tel text := public.so_digitos_fone(p_telefone);
  n   int;
  cod text;
  v   numeric;
  mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  select * into imp from public.impressoras where id = p_impressora and ativo;
  if not found then raise exception 'IMPRESSORA_INDISPONIVEL'; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then raise exception 'DATAS_INVALIDAS'; end if;
  if p_inicio < public.hoje() then raise exception 'DATA_PASSADA'; end if;
  if p_inicio > public.hoje() + 365 then raise exception 'DATA_LONGE'; end if;
  n := p_fim - p_inicio + 1;
  if n > 120 then raise exception 'PERIODO_LONGO'; end if;
  if n < imp.minimo_dias then raise exception 'MINIMO_DIAS:%', imp.minimo_dias; end if;
  if tel !~ '^\d{12,13}$' then raise exception 'TELEFONE_INVALIDO'; end if;
  -- trava simples contra abuso: no máximo 3 pedidos pendentes por telefone
  if (select count(*) from public.reservas r where r.telefone = tel and r.status = 'pendente') >= 3 then
    raise exception 'MUITOS_PEDIDOS';
  end if;

  v := public.valor_periodo(imp, n);
  loop
    cod := public.novo_codigo('GI');
    exit when not exists (select 1 from public.reservas r where r.codigo = cod);
  end loop;

  begin
    insert into public.reservas (codigo, impressora_id, impressora_nome, nome, telefone, email, empresa, observacao, inicio, fim, valor_estimado)
    values (cod, imp.id, left(trim(concat_ws(' ', nullif(imp.marca, ''), imp.nome)), 120), left(trim(p_nome), 80), tel, mail,
            left(trim(coalesce(p_empresa, '')), 80), left(trim(coalesce(p_observacao, '')), 500), p_inicio, p_fim, v);
  exception when exclusion_violation then
    raise exception 'DATAS_OCUPADAS';
  end;

  return query select cod, n, v, trim(concat_ws(' ', nullif(imp.marca, ''), imp.nome));
end $$;

-- Chamado de manutenção feito pelo site
drop function if exists public.abrir_chamado(text, text, text, text, text);
create or replace function public.abrir_chamado(
  p_nome text, p_telefone text, p_modelo text, p_descricao text, p_foto text default null, p_email text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  tel text := public.so_digitos_fone(p_telefone);
  cod text;
  mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if tel !~ '^\d{12,13}$' then raise exception 'TELEFONE_INVALIDO'; end if;
  if mail is not null and mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'EMAIL_INVALIDO'; end if;
  if (select count(*) from public.chamados c where c.telefone = tel and c.criado_em > now() - interval '1 day') >= 5 then
    raise exception 'MUITOS_PEDIDOS';
  end if;
  loop
    cod := public.novo_codigo('GM');
    exit when not exists (select 1 from public.chamados c where c.codigo = cod);
  end loop;
  insert into public.chamados (codigo, nome, telefone, email, modelo, descricao, foto)
  values (cod, left(trim(p_nome), 80), tel, left(mail, 120), left(trim(p_modelo), 80), left(trim(p_descricao), 1000), nullif(p_foto, ''));
  return cod;
end $$;

revoke all on function public.datas_ocupadas(uuid), public.solicitar_reserva(uuid, date, date, text, text, text, text, text),
  public.abrir_chamado(text, text, text, text, text, text), public.novo_codigo(text) from public;
grant execute on function public.datas_ocupadas(uuid), public.solicitar_reserva(uuid, date, date, text, text, text, text, text),
  public.abrir_chamado(text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.impressoras enable row level security;
drop policy if exists "leitura publica" on public.impressoras;
drop policy if exists "equipe le tudo" on public.impressoras;
drop policy if exists "equipe insere" on public.impressoras;
drop policy if exists "equipe altera" on public.impressoras;
drop policy if exists "equipe exclui" on public.impressoras;
create policy "leitura publica" on public.impressoras for select to anon, authenticated using (ativo);
create policy "equipe le tudo" on public.impressoras for select to authenticated using (public.pode_editar());
create policy "equipe insere" on public.impressoras for insert to authenticated with check (public.pode_editar());
create policy "equipe altera" on public.impressoras for update to authenticated using (public.pode_editar()) with check (public.pode_editar());
create policy "equipe exclui" on public.impressoras for delete to authenticated using (public.pode_editar());

-- Reservas e chamados: só a equipe lê e altera. Visitante cria pelas funções acima.
do $$
declare t text;
begin
  foreach t in array array['reservas','chamados'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('drop policy if exists "equipe altera" on public.%I', t);
    execute format('drop policy if exists "equipe exclui" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using (public.pode_editar())', t);
    execute format('create policy "equipe altera" on public.%I for update to authenticated using (public.pode_editar()) with check (public.pode_editar())', t);
    execute format('create policy "equipe exclui" on public.%I for delete to authenticated using (public.e_admin())', t);
  end loop;
end $$;

alter table public.config enable row level security;
drop policy if exists "leitura publica" on public.config;
drop policy if exists "admin edita" on public.config;
create policy "leitura publica" on public.config for select to anon, authenticated using (true);
create policy "admin edita" on public.config for all to authenticated using (public.e_admin()) with check (public.e_admin());

alter table public.equipe_admin enable row level security;

grant select on public.impressoras, public.config to anon;
grant select, insert, update, delete on public.impressoras, public.config to authenticated;
grant select, delete on public.reservas, public.chamados to authenticated;
grant update (status, valor_final, resposta) on public.reservas to authenticated;
grant update (status, nota, resposta) on public.chamados to authenticated;
revoke all on public.reservas, public.chamados from anon;
revoke all on public.equipe_admin from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Bucket de imagens
--    Leitura pública. Fotos das impressoras: só a equipe envia.
--    Fotos da manutenção: o visitante pode enviar (só imagem, até 3 MB,
--    só na pasta manutencao, sem poder apagar ou trocar nada).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', true, 3145728, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = true, file_size_limit = 3145728,
      allowed_mime_types = array['image/webp','image/jpeg','image/png'];

drop policy if exists "imagens: equipe le" on storage.objects;
drop policy if exists "imagens: equipe envia" on storage.objects;
drop policy if exists "imagens: equipe altera" on storage.objects;
drop policy if exists "imagens: equipe exclui" on storage.objects;
drop policy if exists "imagens: visitante envia foto de manutencao" on storage.objects;
create policy "imagens: equipe le" on storage.objects for select to authenticated
  using (bucket_id = 'imagens' and public.pode_editar());
create policy "imagens: equipe envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'imagens' and public.pode_editar()
              and (storage.foldername(name))[1] in ('impressoras', 'manutencao'));
create policy "imagens: equipe altera" on storage.objects for update to authenticated
  using (bucket_id = 'imagens' and public.pode_editar());
create policy "imagens: equipe exclui" on storage.objects for delete to authenticated
  using (bucket_id = 'imagens' and public.pode_editar());
create policy "imagens: visitante envia foto de manutencao" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'imagens' and (storage.foldername(name))[1] = 'manutencao'
              and name ~ '^manutencao/[A-Za-z0-9-]+\.webp$');

-- ---------------------------------------------------------------------
-- 9. Log de alterações (quem, de qual IP, quando e o que mudou)
--    Gravado por gatilhos no banco. Só o admin lê; ninguém edita pelo site.
-- ---------------------------------------------------------------------
create table if not exists public.log_alteracoes (
  id        bigint generated always as identity primary key,
  quando    timestamptz not null default now(),
  email     text,
  ip        text,
  tabela    text not null,
  acao      text not null check (acao in ('criou', 'alterou', 'excluiu')),
  registro  text,
  mudancas  jsonb not null default '{}'
);
create index if not exists log_alteracoes_quando on public.log_alteracoes (quando desc);

alter table public.log_alteracoes enable row level security;
drop policy if exists "admin le log" on public.log_alteracoes;
create policy "admin le log" on public.log_alteracoes for select to authenticated using (public.e_admin());
revoke all on public.log_alteracoes from anon, authenticated;
grant select on public.log_alteracoes to authenticated;

create or replace function public.registrar_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  hdr   jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  novo  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  dif   jsonb := '{}';
  k     text;
  ip    text;
begin
  ip := coalesce(hdr->>'cf-connecting-ip', nullif(trim(split_part(hdr->>'x-forwarded-for', ',', 1)), ''), hdr->>'x-real-ip');
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(novo) loop
      if k not in ('atualizado_em', 'decidido_em', 'decidido_por') and (velho->k) is distinct from (novo->k) then
        dif := dif || jsonb_build_object(k, jsonb_build_object('de', velho->k, 'para', novo->k));
      end if;
    end loop;
    if dif = '{}' then return null; end if;
  elsif tg_op = 'INSERT' then
    dif := novo - 'id' - 'criado_em' - 'atualizado_em';
  else
    dif := velho - 'id' - 'criado_em' - 'atualizado_em';
  end if;

  insert into public.log_alteracoes (email, ip, tabela, acao, registro, mudancas)
  values (
    coalesce(auth.jwt()->>'email', case when auth.jwt()->>'role' = 'anon' then 'Visitante do site' else 'Supabase (SQL/Table Editor)' end),
    left(ip, 64),
    tg_table_name,
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
    left(coalesce(novo->>'codigo', velho->>'codigo', novo->>'nome', velho->>'nome', novo->>'chave', velho->>'chave', novo->>'email', velho->>'email'), 120),
    dif);
  return null;
end $$;
revoke all on function public.registrar_log() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['impressoras','reservas','chamados','config','equipe_admin'] loop
    execute format('drop trigger if exists trg_log on public.%I', t);
    execute format('create trigger trg_log after insert or update or delete on public.%I
                    for each row execute function public.registrar_log()', t);
  end loop;
end $$;

-- Se o e-mail automático (supabase/webhooks.sql) já estiver ligado,
-- avisa também quando um protocolo de manutenção é aceito/recusado/concluído.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'avisar_notificar' and pronamespace = 'public'::regnamespace) then
    drop trigger if exists trg_notificar on public.chamados;
    create trigger trg_notificar after insert or update of status on public.chamados
      for each row execute function public.avisar_notificar();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. Valores iniciais
-- ---------------------------------------------------------------------
insert into public.config (chave, valor) values
  ('whatsapp', '5553992023930'),
  ('horario', 'Seg a sex · 08:30 às 18:00'),
  ('endereco', 'Rua Coronel Onofre Pires, 57 A · Fragata · Pelotas/RS')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 11. Primeiro admin  >>> TROQUE PELO E-MAIL GOOGLE DO DONO <<<
-- ---------------------------------------------------------------------
-- insert into public.equipe_admin (email, papel) values ('dono@gmail.com', 'admin')
--   on conflict (email) do update set papel = 'admin', ativo = true;
