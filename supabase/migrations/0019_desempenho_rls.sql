-- ══════════════════════════════════════════════════════════════════════════
-- 0019 — Desempenho: policies de RLS avaliadas UMA vez por consulta
-- ──────────────────────────────────────────────────────────────────────────
-- Problema: as policies chamavam auth.uid() e fn_is_admin() diretamente. O
-- Postgres reavalia essas chamadas para CADA LINHA. No painel, a view
-- vw_reembolsos soma paradas e pedágios de todos os pedidos, e cada parada/
-- pedágio rodava de novo um EXISTS + fn_is_admin() — milhares de vezes.
--
-- Solução (recomendada pelo Supabase): envolver as chamadas em (select …), o
-- que vira um "InitPlan" calculado uma única vez por consulta, e checar o
-- admin ANTES do EXISTS (se é admin, o EXISTS nem roda).
--
-- QUEM PODE VER/EDITAR O QUÊ NÃO MUDA: as regras são as mesmas, só escritas
-- de forma eficiente. Tudo numa transação: não há instante sem proteção.
-- ══════════════════════════════════════════════════════════════════════════
begin;

-- ── reembolsos ─────────────────────────────────────────────────────────────
drop policy if exists reemb_motorista_read on reembolsos;
create policy reemb_motorista_read on reembolsos for select
  using (motorista_id = (select auth.uid()) or (select fn_is_admin()));

drop policy if exists reemb_motorista_insert on reembolsos;
create policy reemb_motorista_insert on reembolsos for insert
  with check (motorista_id = (select auth.uid()));

drop policy if exists reemb_motorista_update on reembolsos;
create policy reemb_motorista_update on reembolsos for update
  using  (motorista_id = (select auth.uid()) and status in ('ABERTO','REVISÃO'))
  with check (motorista_id = (select auth.uid()) and status not in ('APROVADO','PAGO','REPROVADO'));

drop policy if exists reemb_admin_write on reembolsos;
create policy reemb_admin_write on reembolsos for update
  using ((select fn_is_admin())) with check ((select fn_is_admin()));

drop policy if exists reemb_admin_delete on reembolsos;
create policy reemb_admin_delete on reembolsos for delete
  using ((select fn_is_admin()));

-- ── paradas / pedágios (acompanham o dono do reembolso; admin vê tudo) ─────
drop policy if exists paradas_by_parent on paradas;
create policy paradas_by_parent on paradas for all
  using ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())))
  with check ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())));

drop policy if exists pedagios_by_parent on pedagios;
create policy pedagios_by_parent on pedagios for all
  using ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())))
  with check ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())));

-- ── histórico de correções ─────────────────────────────────────────────────
drop policy if exists revis_read on reembolso_revisoes;
create policy revis_read on reembolso_revisoes for select
  using ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())));

-- ── perfis ─────────────────────────────────────────────────────────────────
drop policy if exists perfis_self_read on perfis;
create policy perfis_self_read on perfis for select
  using (id = (select auth.uid()) or (select fn_is_admin()));

drop policy if exists perfis_admin_all on perfis;
create policy perfis_admin_all on perfis for all
  using ((select fn_is_admin())) with check ((select fn_is_admin()));

drop policy if exists perfis_supervisor_le_motoristas on perfis;
create policy perfis_supervisor_le_motoristas on perfis for select
  using ((select fn_pode_diarias()) and papel = 'motorista');

-- ── diárias ────────────────────────────────────────────────────────────────
drop policy if exists diarias_leitura on diarias;
create policy diarias_leitura on diarias for select
  using ((select fn_pode_diarias()));

drop policy if exists diarias_insere on diarias;
create policy diarias_insere on diarias for insert
  with check ((select fn_pode_diarias()) and registrado_por = (select auth.uid()));

drop policy if exists diarias_remove on diarias;
create policy diarias_remove on diarias for delete
  using ((select fn_is_admin()));

-- ── vans ───────────────────────────────────────────────────────────────────
drop policy if exists van_v_own on van_viagens;
create policy van_v_own on van_viagens for all
  using (motorista_id = (select auth.uid()) or (select fn_is_admin()))
  with check (motorista_id = (select auth.uid()) or (select fn_is_admin()));

drop policy if exists van_p_by_parent on van_pontos;
create policy van_p_by_parent on van_pontos for all
  using ((select fn_is_admin()) or exists (select 1 from van_viagens v
         where v.id = viagem_id and v.motorista_id = (select auth.uid())))
  with check ((select fn_is_admin()) or exists (select 1 from van_viagens v
         where v.id = viagem_id and v.motorista_id = (select auth.uid())));

drop policy if exists van_pax_by_parent on van_passageiros;
create policy van_pax_by_parent on van_passageiros for all
  using ((select fn_is_admin()) or exists (select 1 from van_viagens v
         where v.id = viagem_id and v.motorista_id = (select auth.uid())))
  with check ((select fn_is_admin()) or exists (select 1 from van_viagens v
         where v.id = viagem_id and v.motorista_id = (select auth.uid())));

-- ── demais tabelas administrativas ─────────────────────────────────────────
drop policy if exists emails_admin_all on emails_autorizados;
create policy emails_admin_all on emails_autorizados for all
  using ((select fn_is_admin())) with check ((select fn_is_admin()));

drop policy if exists precos_read on precos_gasolina;
create policy precos_read on precos_gasolina for select
  using ((select auth.uid()) is not null);

drop policy if exists precos_admin_write on precos_gasolina;
create policy precos_admin_write on precos_gasolina for all
  using ((select fn_is_admin())) with check ((select fn_is_admin()));

drop policy if exists auditoria_admin_read on auditoria;
create policy auditoria_admin_read on auditoria for select
  using ((select fn_is_admin()));

-- ── índices para as buscas "meus pedidos" / "meus turnos" ──────────────────
create index if not exists idx_reembolsos_motorista on reembolsos(motorista_id);
create index if not exists idx_van_viagens_motorista on van_viagens(motorista_id);

commit;
