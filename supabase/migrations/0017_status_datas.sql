-- ══════════════════════════════════════════════════════════════════════════
-- 0017 — Marca a DATA em que o pedido foi APROVADO e PAGO
-- ──────────────────────────────────────────────────────────────────────────
-- Guarda o momento em que o status passou para APROVADO e para PAGO, para o
-- painel poder ordenar (ao filtrar por "Aprovado"/"Pago") pela ordem em que o
-- status foi alterado, e para exibir essas datas no detalhe.
--
-- Nada é perdido: só acrescenta duas colunas e as preenche daqui pra frente;
-- os registros antigos recebem uma data aproximada (atualizado_em) no backfill.
-- ══════════════════════════════════════════════════════════════════════════

alter table reembolsos add column if not exists aprovado_em timestamptz;
alter table reembolsos add column if not exists pago_em     timestamptz;

-- Carimba a data ao ENTRAR em cada status (só na transição) ─────────────────
create or replace function fn_marca_status_datas() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'APROVADO' and OLD.status is distinct from 'APROVADO' then
    NEW.aprovado_em := now();
  end if;
  if NEW.status = 'PAGO' and OLD.status is distinct from 'PAGO' then
    NEW.pago_em := now();
  end if;
  return NEW;
end $$;

drop trigger if exists trg_marca_status_datas on reembolsos;
create trigger trg_marca_status_datas
  before update on reembolsos
  for each row execute function fn_marca_status_datas();

-- Backfill dos registros já existentes (data aproximada) ─────────────────────
update reembolsos
   set aprovado_em = coalesce(aprovado_em, atualizado_em, criado_em)
 where status in ('APROVADO','PAGO') and aprovado_em is null;
update reembolsos
   set pago_em = coalesce(pago_em, atualizado_em, criado_em)
 where status = 'PAGO' and pago_em is null;

-- Recria a view para expor as novas colunas (o select usa r.*) ──────────────
drop view if exists vw_reembolsos;
create view vw_reembolsos with (security_invoker = true) as
select
  r.*,
  coalesce(p.qtd_pedagios, 0)   as qtd_pedagios,
  coalesce(p.val_pedagios, 0)   as val_pedagios,
  coalesce(pp.qtd_pendentes, 0) as qtd_ped_pendentes,
  round(r.val_real + coalesce(p.val_pedagios, 0), 2) as val_total,
  coalesce(pr.qtd_paradas, 0)   as qtd_paradas
from reembolsos r
left join (
  select reembolso_id, count(*) qtd_pedagios, sum(valor) val_pedagios
  from pedagios where coalesce(pendente, false) = false
  group by reembolso_id
) p on p.reembolso_id = r.id
left join (
  select reembolso_id, count(*) qtd_pendentes
  from pedagios where coalesce(pendente, false) = true
  group by reembolso_id
) pp on pp.reembolso_id = r.id
left join (
  select reembolso_id, count(*) qtd_paradas
  from paradas group by reembolso_id
) pr on pr.reembolso_id = r.id;

grant select on vw_reembolsos to authenticated;
