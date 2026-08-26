-- ══════════════════════════════════════════════════════════════════════════
-- 0010 — Justificativa da parada adicionada no check-out
-- ──────────────────────────────────────────────────────────────────────────
-- Quando o motorista adiciona uma parada esquecida no check-out, ele passa a
-- ser obrigado a escrever uma justificativa. Guardamos aqui para o gestor ver.
-- Idempotente.
-- ══════════════════════════════════════════════════════════════════════════

alter table paradas add column if not exists justificativa text;
