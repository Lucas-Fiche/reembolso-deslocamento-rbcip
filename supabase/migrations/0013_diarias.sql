-- ══════════════════════════════════════════════════════════════════════════
-- 0013 — DIÁRIAS (controle interno de quem vai atuar no dia)
-- ──────────────────────────────────────────────────────────────────────────
-- O supervisor (e o admin) registram quais motoristas vão atuar em cada data.
-- É só para controle interno — não afeta reembolsos, pedágios, vans etc.
--
-- Requer a 0012 (papel 'supervisor') já efetivada.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Quem pode mexer nas diárias: admin ou supervisor (perfil ativo) ────────
-- (papel::text evita o erro "unsafe use of new value" caso a 0012 e a 0013
--  sejam rodadas na mesma transação — funciona igual em execuções separadas.)
create or replace function fn_pode_diarias() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel::text in ('admin','supervisor')
                   from perfis where id = auth.uid() and ativo = true), false)
$$;

-- ── Tabela de diárias ──────────────────────────────────────────────────────
create table if not exists diarias (
  id             uuid primary key default gen_random_uuid(),
  motorista_id   uuid not null references perfis(id) on delete cascade,
  data           date not null,
  registrado_por uuid references perfis(id),
  criado_em      timestamptz not null default now(),
  unique (motorista_id, data)          -- não duplica o mesmo motorista no mesmo dia
);
create index if not exists idx_diarias_data on diarias(data);

-- ── Segurança (RLS) ────────────────────────────────────────────────────────
alter table diarias enable row level security;

-- Só admin/supervisor leem, inserem e removem. Motorista/van não veem nada.
create policy diarias_leitura on diarias for select
  using (fn_pode_diarias());
create policy diarias_insere on diarias for insert
  with check (fn_pode_diarias() and registrado_por = auth.uid());
create policy diarias_remove on diarias for delete
  using (fn_pode_diarias());

grant select, insert, delete on diarias to authenticated;

-- ── Supervisor precisa enxergar os motoristas para montar a lista ──────────
-- O admin já lê todos os perfis (0002). Esta policy soma o acesso do supervisor
-- APENAS às linhas de motoristas (não a admins/vans/outros supervisores).
create policy perfis_supervisor_le_motoristas on perfis for select
  using (fn_pode_diarias() and papel = 'motorista');
