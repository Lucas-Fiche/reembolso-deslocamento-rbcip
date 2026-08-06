-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Fase 2 · AJUSTES para a migração dos dados da planilha
-- ══════════════════════════════════════════════════════════════════════════
-- O que este arquivo faz (nada destrutivo):
--   1) Alinha os STATUS ao vocabulário que o sistema JÁ usa hoje
--      (COMPLETO no lugar de AGUARDANDO_ANALISE, REVISÃO com acento, e
--       adiciona ABERTO para a viagem em andamento).
--   2) Passa a criar novos reembolsos como ABERTO (a viagem começa no check-in).
--   3) Cria a coluna val_total_planilha — guarda o total ORIGINAL que veio da
--      planilha, para rastreabilidade total do que foi pago (auditoria).
--
-- ⚠️ COMO RODAR: cole a PARTE 1, clique Run. SÓ DEPOIS cole a PARTE 2 e Run.
--    (O Postgres não deixa usar um valor de enum recém-criado na MESMA execução.)
-- ══════════════════════════════════════════════════════════════════════════


-- ══════════════════ PARTE 1 — vocabulário de status (rode PRIMEIRO) ════════
do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
             where t.typname='status_reembolso' and e.enumlabel='AGUARDANDO_ANALISE') then
    alter type status_reembolso rename value 'AGUARDANDO_ANALISE' to 'COMPLETO';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
             where t.typname='status_reembolso' and e.enumlabel='REVISAO') then
    alter type status_reembolso rename value 'REVISAO' to 'REVISÃO';
  end if;
end $$;

alter type status_reembolso add value if not exists 'ABERTO';
-- (CORRIGIDO, APROVADO, PAGO, REPROVADO já existiam e permanecem.)


-- ══════════════════ PARTE 2 — default + auditoria (rode DEPOIS) ════════════
alter table reembolsos alter column status set default 'ABERTO';
alter table reembolsos add column if not exists val_total_planilha numeric(12,2);
