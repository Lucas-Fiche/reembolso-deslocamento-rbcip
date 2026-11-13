-- ══════════════════════════════════════════════════════════════════════════
-- 0021 — Registro das edições feitas pela equipe (quem alterou o quê e quando)
-- ──────────────────────────────────────────────────────────────────────────
-- Motivo: "Editar dados / paradas" no painel grava os novos valores por cima
-- dos antigos e não deixava rastro. Ex.: o preço do combustível mudado de
-- R$ 6,12 para R$ 4,09 por um admin não aparecia em lugar nenhum.
--
-- A partir desta migração, toda alteração feita por um ADMIN (ou direto no
-- banco, sem usuário logado) nos dados de uma solicitação ou nas paradas é
-- gravada com o valor anterior, o novo, quem fez e quando.
-- As alterações do próprio pesquisador continuam no registro de correções
-- (0011); as mudanças de status, no histórico de status (0020).
--
-- Seguro: só CRIA uma tabela e gatilhos que escrevem nela. Não altera dados.
-- ══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists reembolso_edicoes (
  id           bigserial primary key,
  reembolso_id uuid not null references reembolsos(id) on delete cascade,
  por          uuid,                                  -- admin logado (null = SQL/sistema)
  em           timestamptz not null default now(),
  alteracoes   jsonb not null                         -- [{campo, de, para}, …]
);
create index if not exists idx_edicoes_reembolso on reembolso_edicoes(reembolso_id, em);

-- Só registra quando quem altera é admin, ou quando não há usuário (SQL direto).
create or replace function fn_edicao_da_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null or fn_is_admin()
$$;

-- ── Dados da solicitação ──
create or replace function fn_registra_edicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  campos text[] := array[
    'nome','cpf','rg','orgao','email','telefone','veiculo','placa',
    'dist_total','consumo','usou_estimativa','preco_base','preco_real','val_real',
    'caronas','checkin_em','checkout_em'
  ];
  fotos text[] := array['checkin_foto','checkout_foto','cupom_foto','foto_consumo'];
  k text;
  arr jsonb := '[]'::jsonb;
begin
  if not fn_edicao_da_equipe() then return NEW; end if;

  foreach k in array campos loop
    if (o -> k) is distinct from (n -> k) then
      arr := arr || jsonb_build_object('campo', k, 'de', o -> k, 'para', n -> k);
    end if;
  end loop;
  foreach k in array fotos loop
    if (o -> k) is distinct from (n -> k) then
      arr := arr || jsonb_build_object('campo', k,
        'de',   case when coalesce(o ->> k, '') = '' then 'sem foto' else 'foto anterior' end,
        'para', case when coalesce(n ->> k, '') = '' then 'sem foto' else 'nova foto'   end);
    end if;
  end loop;

  if jsonb_array_length(arr) > 0 then
    insert into reembolso_edicoes (reembolso_id, por, alteracoes) values (NEW.id, auth.uid(), arr);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_registra_edicao on reembolsos;
create trigger trg_registra_edicao
  after update on reembolsos
  for each row execute function fn_registra_edicao();

-- ── Paradas (rota) ──
create or replace function fn_registra_edicao_parada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  descr_old text;
  descr_new text;
  rid uuid;
begin
  if not fn_edicao_da_equipe() then return coalesce(NEW, OLD); end if;

  if TG_OP <> 'INSERT' then
    descr_old := initcap(OLD.fase::text) || ': ' || coalesce(OLD.origem,'?') || ' → ' || coalesce(OLD.destino,'?') || ' (' || OLD.km || ' km)';
  end if;
  if TG_OP <> 'DELETE' then
    descr_new := initcap(NEW.fase::text) || ': ' || coalesce(NEW.origem,'?') || ' → ' || coalesce(NEW.destino,'?') || ' (' || NEW.km || ' km)';
  end if;
  -- UPDATE que só reordena (ou não muda nada visível) não é registrado
  if TG_OP = 'UPDATE' and descr_old is not distinct from descr_new then return NEW; end if;

  rid := coalesce(NEW.reembolso_id, OLD.reembolso_id);
  -- solicitação inteira sendo apagada (paradas saem em cascata): nada a registrar
  if not exists (select 1 from reembolsos where id = rid) then return coalesce(NEW, OLD); end if;
  insert into reembolso_edicoes (reembolso_id, por, alteracoes)
  values (rid, auth.uid(), jsonb_build_array(jsonb_build_object(
    'campo', 'parada',
    'de',   coalesce(to_jsonb(descr_old), 'null'::jsonb),
    'para', coalesce(to_jsonb(descr_new), 'null'::jsonb))));
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_registra_edicao_parada on paradas;
create trigger trg_registra_edicao_parada
  after insert or update or delete on paradas
  for each row execute function fn_registra_edicao_parada();

-- Leitura: admin vê tudo; o pesquisador vê as alterações feitas nos próprios pedidos.
alter table reembolso_edicoes enable row level security;
drop policy if exists edicoes_read on reembolso_edicoes;
create policy edicoes_read on reembolso_edicoes for select
  using ((select fn_is_admin()) or exists (select 1 from reembolsos r
         where r.id = reembolso_id and r.motorista_id = (select auth.uid())));
grant select on reembolso_edicoes to authenticated;

commit;
