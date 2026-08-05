-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Migração para Supabase · Fase 0 · SEGURANÇA
-- Row Level Security (RLS) + porta de acesso (lista de e-mails autorizados)
-- ══════════════════════════════════════════════════════════════════════════
--
-- RLS = cada linha só é vista/editada por quem tem direito, garantido pelo
-- BANCO (não pelo frontend). Como o site fala direto com o Supabase, isto é
-- o que protege os dados de verdade.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Helpers de papel do usuário logado ────────────────────────────────────
create or replace function fn_papel() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from perfis where id = auth.uid()
$$;

create or replace function fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from perfis where id = auth.uid()), false)
$$;

-- ── Liga a proteção em todas as tabelas ───────────────────────────────────
alter table perfis            enable row level security;
alter table emails_autorizados enable row level security;
alter table reembolsos        enable row level security;
alter table paradas           enable row level security;
alter table pedagios          enable row level security;
alter table precos_gasolina   enable row level security;
alter table van_viagens       enable row level security;
alter table van_pontos        enable row level security;
alter table van_passageiros   enable row level security;
alter table auditoria         enable row level security;

-- ── PERFIS: cada um lê o próprio; admin lê/edita todos ────────────────────
create policy perfis_self_read on perfis for select using (id = auth.uid() or fn_is_admin());
create policy perfis_admin_all on perfis for all using (fn_is_admin()) with check (fn_is_admin());

-- ── EMAILS AUTORIZADOS: só admin (é a tela de gestão de acesso) ───────────
create policy emails_admin_all on emails_autorizados for all
  using (fn_is_admin()) with check (fn_is_admin());

-- ── REEMBOLSOS: motorista só o seu; admin tudo ────────────────────────────
create policy reemb_motorista_read on reembolsos for select
  using (motorista_id = auth.uid() or fn_is_admin());
create policy reemb_motorista_insert on reembolsos for insert
  with check (motorista_id = auth.uid());
create policy reemb_admin_write on reembolsos for update
  using (fn_is_admin()) with check (fn_is_admin());
create policy reemb_admin_delete on reembolsos for delete using (fn_is_admin());

-- paradas e pedágios acompanham o dono do reembolso pai
create policy paradas_by_parent on paradas for all
  using (exists (select 1 from reembolsos r where r.id = reembolso_id
                 and (r.motorista_id = auth.uid() or fn_is_admin())))
  with check (exists (select 1 from reembolsos r where r.id = reembolso_id
                 and (r.motorista_id = auth.uid() or fn_is_admin())));
create policy pedagios_by_parent on pedagios for all
  using (exists (select 1 from reembolsos r where r.id = reembolso_id
                 and (r.motorista_id = auth.uid() or fn_is_admin())))
  with check (exists (select 1 from reembolsos r where r.id = reembolso_id
                 and (r.motorista_id = auth.uid() or fn_is_admin())));

-- ── PREÇOS: qualquer logado lê (para o app calcular); admin escreve ───────
create policy precos_read on precos_gasolina for select using (auth.uid() is not null);
create policy precos_admin_write on precos_gasolina for all
  using (fn_is_admin()) with check (fn_is_admin());

-- ── VAN: motorista da Van só as suas viagens; admin tudo ──────────────────
create policy van_v_own on van_viagens for all
  using (motorista_id = auth.uid() or fn_is_admin())
  with check (motorista_id = auth.uid() or fn_is_admin());
create policy van_p_by_parent on van_pontos for all
  using (exists (select 1 from van_viagens v where v.id = viagem_id
                 and (v.motorista_id = auth.uid() or fn_is_admin())))
  with check (exists (select 1 from van_viagens v where v.id = viagem_id
                 and (v.motorista_id = auth.uid() or fn_is_admin())));
create policy van_pax_by_parent on van_passageiros for all
  using (exists (select 1 from van_viagens v where v.id = viagem_id
                 and (v.motorista_id = auth.uid() or fn_is_admin())))
  with check (exists (select 1 from van_viagens v where v.id = viagem_id
                 and (v.motorista_id = auth.uid() or fn_is_admin())));

-- ── AUDITORIA: admin lê; gravação é feita pelo servidor (service role) ────
create policy auditoria_admin_read on auditoria for select using (fn_is_admin());


-- ══════════════════════════════════════════════════════════════════════════
-- PORTA DE ACESSO — só entra quem está na lista de autorizados
-- ══════════════════════════════════════════════════════════════════════════
--
-- 1) Quando um usuário é criado no Auth, este gatilho monta o perfil dele
--    JÁ COM O PAPEL definido na lista (motorista / van / admin).
-- 2) Se o e-mail não estiver na lista (e ativo), a criação é BLOQUEADA.
--    Assim, ninguém de fora consegue entrar mesmo pedindo o código.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function fn_ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_papel papel_usuario;
  v_nome  text;
begin
  select papel, nome into v_papel, v_nome
  from emails_autorizados
  where email = new.email and ativo = true
  limit 1;

  if v_papel is null then
    raise exception 'E-mail não autorizado a acessar o sistema (%).', new.email;
  end if;

  insert into perfis (id, nome, email, papel)
  values (new.id, coalesce(v_nome, new.raw_user_meta_data->>'nome'), new.email, v_papel);

  return new;
end $$;

create trigger trg_ao_criar_usuario
  after insert on auth.users
  for each row execute function fn_ao_criar_usuario();

-- OBS.: a experiência ideal é também recusar o ENVIO do código para quem não
-- está na lista (via "Before User Created Hook" no painel do Supabase). O
-- passo exato de ativação desse hook está no arquivo SETUP.md.
