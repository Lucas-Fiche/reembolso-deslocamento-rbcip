-- ══════════════════════════════════════════════════════════════════════════
-- 0009 — Parada adicionada no check-out (motorista esqueceu no percurso)
-- ──────────────────────────────────────────────────────────────────────────
-- Quando o motorista esquece de lançar uma parada durante a viagem, ele pode
-- adicioná-la no CHECK-OUT (com origem/destino/km + print do Maps, mas sem o
-- GPS/horário do momento, que não existe mais). Esta coluna marca essas
-- paradas para o painel sinalizar com transparência ao gestor.
-- Idempotente.
-- ══════════════════════════════════════════════════════════════════════════

alter table paradas add column if not exists adicionada_checkout boolean not null default false;
