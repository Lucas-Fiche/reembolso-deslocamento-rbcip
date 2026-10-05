-- ══════════════════════════════════════════════════════════════════════════
-- 0018 — Limpa as datas APROXIMADAS de aprovação/pagamento
-- ──────────────────────────────────────────────────────────────────────────
-- A 0017 preencheu aprovado_em/pago_em dos registros antigos com uma data
-- aproximada (atualizado_em). Como a 0016 havia atualizado muitos registros,
-- essa aproximação caiu quase toda em "hoje" — ou seja, não é confiável.
--
-- A pedido: em vez de mostrar uma data inventada, deixamos esses campos VAZIOS
-- (o painel passa a exibir "sem data disponível"). Daqui pra frente o gatilho
-- da 0017 grava a data REAL de cada nova aprovação/pagamento.
--
-- (Rode UMA vez, logo após a 0017. Pedidos aprovados/pagos DEPOIS desta limpeza
--  já terão a data correta e não são afetados.)
-- ══════════════════════════════════════════════════════════════════════════

update reembolsos set aprovado_em = null, pago_em = null;
