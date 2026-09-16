-- ══════════════════════════════════════════════════════════════════════════
-- 0012 — Novo papel: SUPERVISOR
-- ──────────────────────────────────────────────────────────────────────────
-- Adiciona o papel "supervisor" ao vocabulário de papéis.
--
-- IMPORTANTE: "alter type ... add value" precisa ser EFETIVADO (committed)
-- ANTES de o novo valor ser usado como literal em policies/gatilhos. Por isso
-- este passo fica numa migração SEPARADA da 0013 (que já usa 'supervisor').
-- Rode a 0012 primeiro e a 0013 em seguida.
-- ══════════════════════════════════════════════════════════════════════════

alter type papel_usuario add value if not exists 'supervisor';
