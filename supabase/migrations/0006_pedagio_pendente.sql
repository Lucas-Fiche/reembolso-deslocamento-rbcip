-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Fase 2 · PEDÁGIO PENDENTE (solicitação que exige análise do admin)
-- ══════════════════════════════════════════════════════════════════════════
-- Quando o motorista lança um pedágio depois de enviar o reembolso, ele NÃO
-- pode entrar no total automaticamente — precisa ser analisado. Este ajuste:
--   1) marca esses pedágios como "pendente";
--   2) faz a view NÃO somar pedágios pendentes no total (até serem aprovados);
--   3) expõe a contagem de pendentes, para o painel destacar essas solicitações.
-- Idempotente.
-- ══════════════════════════════════════════════════════════════════════════

alter table pedagios add column if not exists pendente boolean not null default false;

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
