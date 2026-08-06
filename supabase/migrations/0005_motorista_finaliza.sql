-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Fase 2 · o motorista pode FINALIZAR/CORRIGIR o próprio reembolso
-- ══════════════════════════════════════════════════════════════════════════
-- No fluxo novo, o motorista cria o reembolso no check-in (ABERTO) e depois
-- precisa ATUALIZÁ-LO para enviar (COMPLETO) — e, se cair em revisão, corrigir
-- (CORRIGIDO). As regras originais só deixavam o ADMIN atualizar.
--
-- Esta política libera o motorista a atualizar APENAS:
--   • o próprio reembolso (motorista_id = ele), e
--   • somente enquanto está ABERTO ou em REVISÃO (não toca em pedidos já em
--     análise/aprovados/pagos), e
--   • sem poder se auto-aprovar (os status de admin ficam proibidos no destino).
-- Idempotente (dropa antes de criar).
-- ══════════════════════════════════════════════════════════════════════════
drop policy if exists reemb_motorista_update on reembolsos;
create policy reemb_motorista_update on reembolsos for update
  using  (motorista_id = auth.uid() and status in ('ABERTO','REVISÃO'))
  with check (motorista_id = auth.uid() and status not in ('APROVADO','PAGO','REPROVADO'));
