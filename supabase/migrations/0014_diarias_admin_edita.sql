-- ══════════════════════════════════════════════════════════════════════════
-- 0014 — Diárias: histórico protegido
-- ──────────────────────────────────────────────────────────────────────────
-- O supervisor REGISTRA (insere) as diárias, mas NÃO pode apagá-las depois.
-- Só o ADMIN remove um registro. Assim o histórico fica preservado e não é
-- editável pelos supervisores após a seleção dos motoristas.
--
-- (Não existe policy nem GRANT de UPDATE em `diarias` — ou seja, nenhuma linha
--  pode ser alterada no lugar; a correção é sempre remover, e só o admin pode.)
-- ══════════════════════════════════════════════════════════════════════════

drop policy if exists diarias_remove on diarias;
create policy diarias_remove on diarias for delete
  using (fn_is_admin());
