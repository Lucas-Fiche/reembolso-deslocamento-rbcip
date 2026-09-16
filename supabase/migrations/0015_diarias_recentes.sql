-- ══════════════════════════════════════════════════════════════════════════
-- 0015 — Diárias: listagem completa dos registros (com nomes)
-- ──────────────────────────────────────────────────────────────────────────
-- A tela de "Registros recentes" precisa mostrar: data da atuação, motorista,
-- quem registrou e quando registrou. Como o supervisor não lê os perfis de
-- admins/supervisores (só de motoristas), resolvemos os nomes numa função
-- SECURITY DEFINER que já devolve tudo pronto — e que só responde para quem
-- pode ver diárias (admin/supervisor).
-- ══════════════════════════════════════════════════════════════════════════

create or replace function fn_diarias_recentes(p_limite int default 400)
returns table(
  id             uuid,
  data           date,
  motorista_id   uuid,
  motorista      text,
  registrado_por uuid,
  registrador    text,
  criado_em      timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id, d.data, d.motorista_id, pm.nome,
         d.registrado_por, pr.nome, d.criado_em
  from diarias d
  left join perfis pm on pm.id = d.motorista_id
  left join perfis pr on pr.id = d.registrado_por
  where fn_pode_diarias()                       -- só admin/supervisor recebem linhas
  order by d.data desc, d.criado_em desc
  limit greatest(1, least(coalesce(p_limite,400), 2000))
$$;

grant execute on function fn_diarias_recentes(int) to authenticated;
