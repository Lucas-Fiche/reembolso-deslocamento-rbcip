-- ══════════════════════════════════════════════════════════════════════════
-- 0020 — Histórico de mudanças de status (quem mudou, de qual para qual, quando)
-- ──────────────────────────────────────────────────────────────────────────
-- Motivo: até aqui só ficava registrado o status ATUAL. Quando uma solicitação
-- volta de "Corrigido" para "Em revisão", não havia como saber quem fez isso
-- nem quando. A partir desta migração, TODA mudança de status (feita pelo
-- painel, pelo pesquisador ou direto no banco) é gravada automaticamente.
--
-- Seguro: só CRIA uma tabela nova e um gatilho que escreve nela. Não altera
-- nenhum dado existente. O histórico começa a contar a partir de agora.
-- ══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists reembolso_status_log (
  id           bigserial primary key,
  reembolso_id uuid not null references reembolsos(id) on delete cascade,
  de           status_reembolso,              -- null = criação da solicitação
  para         status_reembolso not null,
  por          uuid,                          -- usuário logado que fez a mudança (null = sistema/SQL)
  em           timestamptz not null default now()
);
create index if not exists idx_status_log_reembolso on reembolso_status_log(reembolso_id, em);

create or replace function fn_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into reembolso_status_log (reembolso_id, de, para, por)
    values (NEW.id, null, NEW.status, auth.uid());
  elsif NEW.status is distinct from OLD.status then
    insert into reembolso_status_log (reembolso_id, de, para, por)
    values (NEW.id, OLD.status, NEW.status, auth.uid());
  end if;
  return NEW;
end $$;

drop trigger if exists trg_log_status on reembolsos;
create trigger trg_log_status
  after insert or update of status on reembolsos
  for each row execute function fn_log_status();

-- Leitura: admin vê tudo; o pesquisador vê o histórico dos próprios pedidos.
-- Ninguém escreve direto (só o gatilho, que roda como dono da função).
alter table reembolso_status_log enable row level security;
drop policy if exists status_log_read on reembolso_status_log;
create policy status_log_read on reembolso_status_log for select
  using ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())));
grant select on reembolso_status_log to authenticated;

commit;
