-- =====================================================================
--  OPCIONAL · Liga o e-mail automático (função "notificar") por SQL,
--  no lugar de criar os Database Webhooks pela tela do Supabase.
--  1) Troque TROQUE_PELO_WEBHOOK_SECRET pelo mesmo valor do secret WEBHOOK_SECRET
--     (Edge Functions > Secrets). Não salve o arquivo com o segredo no GitHub.
--  2) Rode no SQL Editor. Pode rodar de novo sem problema.
-- =====================================================================
create extension if not exists pg_net;

create or replace function public.avisar_notificar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url     := 'https://ciwcqsngxeqikaqkivlg.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'TROQUE_PELO_WEBHOOK_SECRET'),
    body    := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'record', to_jsonb(new),
                                  'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end));
  return null;
end $$;
revoke all on function public.avisar_notificar() from public, anon, authenticated;

drop trigger if exists trg_notificar on public.reservas;
create trigger trg_notificar after insert or update of status on public.reservas
  for each row execute function public.avisar_notificar();

drop trigger if exists trg_notificar on public.chamados;
create trigger trg_notificar after insert or update of status on public.chamados
  for each row execute function public.avisar_notificar();
