-- ══════════════════════════════════════════════════════════════════════════
-- 0008 — Revogação REAL de acesso ao remover/desativar da lista de autorizados
-- ──────────────────────────────────────────────────────────────────────────
-- Problema corrigido:
--   A "porta" (fn_ao_criar_usuario) só é checada na CRIAÇÃO da conta. Depois que
--   a pessoa entrou uma vez, o usuário do Auth já existe e pedir um novo código
--   apenas reenvia o login — sem reconsultar a lista. Resultado: remover um
--   e-mail da lista NÃO revogava quem já tinha entrado (continuava logando, e
--   com o papel antigo).
--
-- Solução:
--   1) Os helpers de papel passam a exigir perfil ATIVO (RLS nega dados de
--      perfis desativados).
--   2) fn_revogar_acesso(email, bloquear): desativa/reativa o perfil e — quando
--      houver privilégio — bane/desbane o usuário no Auth (bloqueia o login).
--   3) Gatilhos na lista de autorizados: INSERT/UPDATE aplica papel+situação;
--      DELETE bloqueia o e-mail removido.
--   4) Backfill seguro: bloqueia contas NÃO-admin que não estão mais ativas na
--      lista (admins nunca são bloqueados automaticamente aqui, para não travar
--      a operação). Reativa quem está ativo na lista.
-- Idempotente. Supera a 0007 (recria fn_sync_perfil_autorizado com a situação).
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Helpers de papel exigem perfil ATIVO ───────────────────────────────────
create or replace function fn_papel() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from perfis where id = auth.uid() and ativo = true
$$;

create or replace function fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from perfis where id = auth.uid() and ativo = true), false)
$$;

-- 2) Revoga (ou reativa) o acesso de um e-mail ──────────────────────────────
--    Desativa/ativa o perfil e, quando houver privilégio em auth.users,
--    bane/desbane o login. Se não houver privilégio, o bloqueio ainda vale
--    pela situação do perfil (perfis.ativo) + a checagem no frontend.
create or replace function fn_revogar_acesso(p_email citext, p_bloquear boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update perfis set ativo = not p_bloquear where email = p_email;
  begin
    if p_bloquear then
      update auth.users set banned_until = 'infinity' where email = p_email;
    else
      update auth.users set banned_until = null where email = p_email;
    end if;
  exception when others then
    null; -- sem privilégio para alterar auth.users: seguimos com perfis.ativo + RLS + frontend
  end;
end $$;

-- 3) Gatilhos na lista de autorizados ───────────────────────────────────────
-- INSERT/UPDATE: sincroniza papel/nome do perfil e aplica a situação (ativo).
create or replace function fn_sync_perfil_autorizado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update perfis p
     set papel = new.papel,
         nome  = coalesce(nullif(new.nome, ''), p.nome)
   where p.email = new.email;
  perform fn_revogar_acesso(new.email, not coalesce(new.ativo, true));
  return new;
end $$;

-- DELETE: bloqueia o acesso do e-mail removido.
create or replace function fn_ao_remover_autorizado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_revogar_acesso(old.email, true);
  return old;
end $$;

drop trigger if exists trg_sync_perfil_autorizado on emails_autorizados;
create trigger trg_sync_perfil_autorizado
  after insert or update on emails_autorizados
  for each row execute function fn_sync_perfil_autorizado();

drop trigger if exists trg_ao_remover_autorizado on emails_autorizados;
create trigger trg_ao_remover_autorizado
  after delete on emails_autorizados
  for each row execute function fn_ao_remover_autorizado();

-- 4) Backfill seguro ────────────────────────────────────────────────────────
do $$
declare r record;
begin
  -- Bloqueia contas NÃO-admin que já não estão ativas na lista
  -- (corrige quem foi removido antes deste ajuste, como o e-mail de teste).
  for r in
    select p.email from perfis p
    where p.papel <> 'admin'
      and not exists (select 1 from emails_autorizados e where e.email = p.email and e.ativo = true)
  loop
    perform fn_revogar_acesso(r.email, true);
  end loop;
  -- Garante que quem está ATIVO na lista permaneça liberado.
  for r in
    select e.email from emails_autorizados e where e.ativo = true
  loop
    perform fn_revogar_acesso(r.email, false);
  end loop;
end $$;
