-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Migração · Conferência da correção
-- Registra QUAIS CAMPOS o pesquisador alterou ao enviar a correção,
-- para o admin conferir antes de aprovar (REVISÃO → CORRIGIDO).
-- ══════════════════════════════════════════════════════════════════════════
--
-- Nada é perdido: quando um pedido volta da correção, guardamos numa tabela
-- própria a lista {campo, de, para} do que mudou. O valor atual do pedido
-- continua na tabela reembolsos; aqui fica só o histórico do que foi trocado.
-- Se um pedido for revisado mais de uma vez, cada correção vira um registro.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Onde guardamos o que mudou em cada correção ───────────────────────────
create table if not exists reembolso_revisoes (
  id           uuid primary key default gen_random_uuid(),
  reembolso_id uuid not null references reembolsos(id) on delete cascade,
  criado_em    timestamptz not null default now(),
  alteracoes   jsonb not null default '[]'::jsonb   -- [{campo, de, para}, …]
);
create index if not exists idx_reembolso_revisoes_reembolso
  on reembolso_revisoes(reembolso_id);

-- ── Gatilho: ao enviar a correção, calcula o diff e grava ─────────────────
-- Roda como SECURITY DEFINER (dono da tabela), então a inserção é feita pelo
-- próprio banco — o frontend não escreve aqui (não há GRANT de insert), o que
-- impede adulteração do histórico.
create or replace function fn_registra_correcao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  -- campos de número/texto: guardamos o valor antigo e o novo
  campos text[] := array[
    'dist_total','consumo','usou_estimativa','preco_base','preco_real',
    'val_estimado','val_real','caronas'
  ];
  -- fotos: não guardamos o conteúdo, só sinalizamos que houve troca
  fotos  text[] := array['checkout_foto','cupom_foto','foto_consumo'];
  k text;
  arr jsonb := '[]'::jsonb;
begin
  -- Só registra no momento em que o pesquisador ENVIA a correção.
  if OLD.status = 'REVISÃO' and NEW.status = 'CORRIGIDO' then

    foreach k in array campos loop
      if (o -> k) is distinct from (n -> k) then
        arr := arr || jsonb_build_object('campo', k, 'de', o -> k, 'para', n -> k);
      end if;
    end loop;

    foreach k in array fotos loop
      if (o -> k) is distinct from (n -> k) then
        arr := arr || jsonb_build_object(
          'campo', k,
          'de',   case when coalesce(o ->> k, '') = '' then 'sem foto' else 'foto anterior' end,
          'para', case when coalesce(n ->> k, '') = '' then 'sem foto' else 'nova foto'   end
        );
      end if;
    end loop;

    if jsonb_array_length(arr) > 0 then
      insert into reembolso_revisoes (reembolso_id, alteracoes) values (NEW.id, arr);
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_registra_correcao on reembolsos;
create trigger trg_registra_correcao
  after update on reembolsos
  for each row execute function fn_registra_correcao();

-- ── Quem pode ler ─────────────────────────────────────────────────────────
alter table reembolso_revisoes enable row level security;

-- Admin lê tudo; o pesquisador lê o histórico do próprio pedido (transparência).
create policy revis_read on reembolso_revisoes for select
  using (
    fn_is_admin()
    or exists (select 1 from reembolsos r
               where r.id = reembolso_id and r.motorista_id = auth.uid())
  );

-- Só leitura pelo app; a escrita é feita exclusivamente pelo gatilho acima.
grant select on reembolso_revisoes to authenticated;
