-- ══════════════════════════════════════════════════════════════════════════
-- 0016 — Vincula reembolsos IMPORTADOS ao login do pesquisador (por e-mail)
-- ──────────────────────────────────────────────────────────────────────────
-- Problema:
--   Os reembolsos importados do sistema antigo entraram SEM `motorista_id`
--   (o importador não preenche essa coluna). Por isso eles:
--     • não aparecem para o pesquisador em "Viagens realizadas" (o app filtra
--       por motorista_id = conta logada); e
--     • ficam escondidos pela RLS (regra: motorista_id = auth.uid()).
--   Resultado: um pedido colocado "Em revisão" pelo gestor não aparecia para o
--   pesquisador corrigir, mesmo tendo recebido o e-mail.
--
-- Solução (nada é perdido — só preenche o vínculo que faltava):
--   1) Backfill único: liga cada reembolso sem dono ao perfil que tem o MESMO
--      e-mail (e-mail é citext → comparação sem diferenciar maiúsc./minúsc.).
--   2) Daqui pra frente: ao criar um perfil (primeiro login), os reembolsos
--      importados com o mesmo e-mail são vinculados automaticamente.
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Backfill único (idempotente: só mexe em quem está sem dono) ────────────
update reembolsos r
   set motorista_id = p.id
  from perfis p
 where r.motorista_id is null
   and r.email is not null
   and r.email = p.email;

-- 2) Vínculo automático no primeiro login (quando o perfil é criado) ────────
create or replace function fn_vincula_reembolsos_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update reembolsos
     set motorista_id = new.id
   where motorista_id is null
     and email is not null
     and email = new.email;
  return new;
end $$;

drop trigger if exists trg_vincula_reembolsos on perfis;
create trigger trg_vincula_reembolsos
  after insert on perfis
  for each row execute function fn_vincula_reembolsos_perfil();
