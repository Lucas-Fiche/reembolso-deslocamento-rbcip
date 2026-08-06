-- ══════════════════════════════════════════════════════════════════════════
-- RBCIP — Fase 2 · CORREÇÃO DE FUSO nos dados migrados
-- ══════════════════════════════════════════════════════════════════════════
-- Os horários vieram da planilha como "naive" e foram interpretados como UTC.
-- Como São Paulo é UTC-3 (sem horário de verão), os horários ficaram 3h mais
-- cedo. Este ajuste soma 3 horas a cada horário importado, para representar o
-- instante local correto.
--
-- ✅ SEGURO RODAR MAIS DE UMA VEZ: um marcador (_fuso_corrigido) garante que a
--    soma acontece UMA única vez. Se rodar de novo, não faz nada.
-- ⚠️ Rode ANTES de o novo formulário começar a gravar dados (só corrige os
--    registros da migração; novos registros já entram com o fuso certo).
-- ══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_class where relname = '_fuso_corrigido') then
    update reembolsos
       set checkin_em  = checkin_em  + interval '3 hours',
           checkout_em = checkout_em + interval '3 hours',
           criado_em   = criado_em   + interval '3 hours';
    update paradas
       set horario = horario + interval '3 hours'
     where horario is not null;
    create table _fuso_corrigido (corrigido_em timestamptz not null default now());
    insert into _fuso_corrigido default values;
  end if;
end $$;
