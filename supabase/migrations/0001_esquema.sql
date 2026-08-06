-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Reembolso de Deslocamento
-- Migração para Supabase · Fase 0 · ESQUEMA DO BANCO
-- ══════════════════════════════════════════════════════════════════════════
--
-- Este arquivo NÃO altera o sistema atual. É o desenho do banco novo, para
-- você revisar. Só terá efeito quando for rodado dentro do SEU projeto
-- Supabase (SQL Editor), depois de aprovado.
--
-- Princípio de projeto: os valores em dinheiro NÃO são digitados soltos.
-- As paradas e os pedágios viram tabelas próprias; o valor de combustível é
-- uma COLUNA CALCULADA pelo banco; e o total de pedágios / total geral vêm
-- de uma VIEW que soma as cobranças. Assim é impossível o valor "travar" ou
-- ficar dessincronizado (o bug que corrigimos no sistema antigo).
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists "citext";      -- e-mails sem diferenciar maiúsc/minúsc

-- ── Tipos controlados (evita status/papel escritos "à mão") ────────────────
do $$ begin
  create type papel_usuario as enum ('motorista', 'van', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_reembolso as enum
    ('AGUARDANDO_ANALISE','REVISAO','CORRIGIDO','APROVADO','PAGO','REPROVADO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fase_trecho as enum ('ida','volta');
exception when duplicate_object then null; end $$;


-- ══════════════════════════════════════════════════════════════════════════
-- ACESSO / USUÁRIOS
-- ══════════════════════════════════════════════════════════════════════════

-- Lista de quem pode entrar. Gerida pela tela do painel (você + admins).
-- É a "porta": quem não está aqui (e não é admin convidado) não cria conta.
create table emails_autorizados (
  id          uuid primary key default gen_random_uuid(),
  email       citext unique not null,
  papel       papel_usuario not null default 'motorista',
  nome        text,
  ativo       boolean not null default true,
  convidado_por uuid,                          -- perfil do admin que cadastrou
  criado_em   timestamptz not null default now()
);

-- Perfil do usuário logado (espelha auth.users, do Supabase Auth).
create table perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  email      citext,
  papel      papel_usuario not null default 'motorista',
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);


-- ══════════════════════════════════════════════════════════════════════════
-- REEMBOLSO (o pedido) + PARADAS + PEDÁGIOS
-- ══════════════════════════════════════════════════════════════════════════

create table reembolsos (
  id            uuid primary key default gen_random_uuid(),
  protocolo     text unique not null,
  status        status_reembolso not null default 'AGUARDANDO_ANALISE',

  -- quem enviou (conta logada) + retrato dos dados no momento do envio
  motorista_id  uuid references perfis(id),
  nome          text,
  cpf           text,
  email         citext,
  telefone      text,
  rg            text,
  orgao         text,
  veiculo       text,
  placa         text,

  -- check-in / check-out
  checkin_em    timestamptz,
  checkin_lat   double precision,
  checkin_lng   double precision,
  checkin_foto  text,
  checkout_em   timestamptz,
  checkout_lat  double precision,
  checkout_lng  double precision,
  checkout_foto text,

  -- números da viagem (as PARADAS ficam na tabela própria)
  dist_total    numeric(10,2) not null default 0,   -- soma dos km das paradas
  consumo       numeric(6,2)  not null default 10,   -- km/L
  usou_estimativa boolean not null default true,
  preco_base    numeric(6,3)  not null default 4.670, -- R$/L vigente na data
  preco_real    numeric(6,3),                         -- R$/L do cupom, se houver
  cupom_foto    text,

  -- ── VALORES CALCULADOS PELO BANCO (impossível dessincronizar) ──
  -- combustível estimado e real derivados só de colunas desta mesma linha
  val_estimado numeric(12,2) generated always as
    (round((dist_total / nullif(consumo,0)) * preco_base, 2)) stored,
  val_real numeric(12,2) generated always as
    (round((dist_total / nullif(consumo,0)) *
      (case when usou_estimativa then preco_base else coalesce(preco_real, preco_base) end), 2)) stored,
  -- (o total de pedágios e o TOTAL GERAL vêm da view vw_reembolsos, somando
  --  a tabela de pedágios — nunca de um número digitado à parte)

  validacao     text,
  recibo_link   text,
  caronas       text,
  foto_consumo  text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table paradas (
  id           uuid primary key default gen_random_uuid(),
  reembolso_id uuid not null references reembolsos(id) on delete cascade,
  fase         fase_trecho not null,
  ordem        int not null default 1,
  origem       text,
  destino      text,
  km           numeric(10,2) not null default 0,
  lat          double precision,
  lng          double precision,
  horario      timestamptz,
  maps_link    text,
  foto_link    text
);
create index idx_paradas_reembolso on paradas(reembolso_id);

create table pedagios (
  id           uuid primary key default gen_random_uuid(),
  reembolso_id uuid not null references reembolsos(id) on delete cascade,
  fase         fase_trecho,
  ordem        int not null default 1,
  valor        numeric(10,2) not null default 0,
  comprovante_link text
);
create index idx_pedagios_reembolso on pedagios(reembolso_id);


-- ══════════════════════════════════════════════════════════════════════════
-- PREÇOS DA GASOLINA POR PERÍODO
-- ══════════════════════════════════════════════════════════════════════════
create table precos_gasolina (
  id            uuid primary key default gen_random_uuid(),
  inicio        date not null,
  fim           date,
  valor         numeric(6,3) not null,
  registrado_por text,
  criado_em     timestamptz not null default now()
);


-- ══════════════════════════════════════════════════════════════════════════
-- VAN — registro de deslocamento (sem cálculo de reembolso)
-- ══════════════════════════════════════════════════════════════════════════
create table van_viagens (
  id           uuid primary key default gen_random_uuid(),
  motorista_id uuid references perfis(id),
  inicio_turno timestamptz,
  fim_turno    timestamptz,
  observacao   text,
  criado_em    timestamptz not null default now()
);

create table van_pontos (
  id         uuid primary key default gen_random_uuid(),
  viagem_id  uuid not null references van_viagens(id) on delete cascade,
  ordem      int not null default 1,
  local      text,
  horario    timestamptz,
  lat        double precision,
  lng        double precision
);
create index idx_van_pontos_viagem on van_pontos(viagem_id);

-- Passageiros por NOME. A QUANTIDADE é calculada automaticamente (contagem
-- destas linhas), nunca digitada — atende ao seu pedido.
create table van_passageiros (
  id         uuid primary key default gen_random_uuid(),
  viagem_id  uuid not null references van_viagens(id) on delete cascade,
  nome       text not null,
  criado_em  timestamptz not null default now()
);
create index idx_van_passageiros_viagem on van_passageiros(viagem_id);


-- ══════════════════════════════════════════════════════════════════════════
-- VIEWS — leitura pronta para o painel (valores sempre coerentes)
-- ══════════════════════════════════════════════════════════════════════════

-- Reembolso com total de pedágios e TOTAL GERAL somados na hora, a partir
-- das cobranças reais. É esta view que o painel/recibo devem ler.
create view vw_reembolsos with (security_invoker = true) as
select
  r.*,
  coalesce(p.qtd_pedagios, 0)          as qtd_pedagios,
  coalesce(p.val_pedagios, 0)          as val_pedagios,
  round(r.val_real + coalesce(p.val_pedagios, 0), 2) as val_total,
  coalesce(pr.qtd_paradas, 0)          as qtd_paradas
from reembolsos r
left join (
  select reembolso_id, count(*) qtd_pedagios, sum(valor) val_pedagios
  from pedagios group by reembolso_id
) p on p.reembolso_id = r.id
left join (
  select reembolso_id, count(*) qtd_paradas
  from paradas group by reembolso_id
) pr on pr.reembolso_id = r.id;

-- Viagem da Van com a contagem automática de passageiros e de pontos.
create view vw_van_viagens with (security_invoker = true) as
select
  v.*,
  coalesce(pax.qtd_passageiros, 0) as qtd_passageiros,
  coalesce(pt.qtd_pontos, 0)       as qtd_pontos
from van_viagens v
left join (
  select viagem_id, count(*) qtd_passageiros
  from van_passageiros group by viagem_id
) pax on pax.viagem_id = v.id
left join (
  select viagem_id, count(*) qtd_pontos
  from van_pontos group by viagem_id
) pt on pt.viagem_id = v.id;


-- ══════════════════════════════════════════════════════════════════════════
-- AUDITORIA — quem alterou o quê (substitui a coluna de texto antiga)
-- ══════════════════════════════════════════════════════════════════════════
create table auditoria (
  id           uuid primary key default gen_random_uuid(),
  reembolso_id uuid references reembolsos(id) on delete cascade,
  usuario      text,
  acao         text,
  em           timestamptz not null default now()
);
create index idx_auditoria_reembolso on auditoria(reembolso_id);

-- mantém reembolsos.atualizado_em em dia
create or replace function fn_touch_atualizado_em() returns trigger
language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;

create trigger trg_reembolsos_touch
  before update on reembolsos
  for each row execute function fn_touch_atualizado_em();
