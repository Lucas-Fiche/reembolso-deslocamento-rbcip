-- ══════════════════════════════════════════════════════════════════════════
-- 0007 — Sincroniza perfis.papel com emails_autorizados
-- ──────────────────────────────────────────────────────────────────────────
-- Problema corrigido:
--   Ao remover um e-mail da lista e readicioná-lo com OUTRO papel (ex.: de
--   "motorista" para "van"), o usuário do Supabase Auth já existia. O gatilho
--   fn_ao_criar_usuario só roda em "after insert on auth.users", então NÃO
--   dispara de novo — e o perfil continuava com o papel antigo.
--
-- Solução:
--   Um gatilho em emails_autorizados que, sempre que uma linha é inserida ou
--   atualizada, alinha o papel (e o nome) do perfil correspondente. Assim, o
--   que o admin definir na lista de autorizados passa a valer no próximo acesso
--   — sem depender de recriar o usuário no Auth.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function fn_sync_perfil_autorizado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- email é citext nas duas tabelas → a comparação já é case-insensitive.
  update perfis p
     set papel = new.papel,
         nome  = coalesce(nullif(new.nome, ''), p.nome)
   where p.email = new.email
     and (p.papel is distinct from new.papel
          or (new.nome is not null and new.nome <> '' and p.nome is distinct from new.nome));
  return new;
end $$;

drop trigger if exists trg_sync_perfil_autorizado on emails_autorizados;
create trigger trg_sync_perfil_autorizado
  after insert or update on emails_autorizados
  for each row execute function fn_sync_perfil_autorizado();

-- Backfill único: alinha os perfis já existentes ao papel atual da lista.
update perfis p
   set papel = ea.papel
  from emails_autorizados ea
 where p.email = ea.email
   and p.papel is distinct from ea.papel;
