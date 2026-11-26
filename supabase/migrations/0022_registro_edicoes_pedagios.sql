-- ══════════════════════════════════════════════════════════════════════════
-- 0022 — Registro das alterações de PEDÁGIOS feitas pela equipe
-- ──────────────────────────────────────────────────────────────────────────
-- Complementa a 0021 (dados e paradas): agora que o painel permite à equipe
-- incluir, remover e alterar pedágios (valor, trecho, comprovante), essas
-- mudanças também ficam no histórico — com quem fez e quando.
-- Requer a 0021 (usa a tabela reembolso_edicoes e fn_edicao_da_equipe).
--
-- Seguro: só cria uma função e um gatilho. Não altera dados.
-- ══════════════════════════════════════════════════════════════════════════
begin;

create or replace function fn_registra_edicao_pedagio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d_old text;
  d_new text;
  rid uuid;
begin
  if not fn_edicao_da_equipe() then return coalesce(NEW, OLD); end if;

  if TG_OP <> 'INSERT' then
    d_old := initcap(coalesce(OLD.fase::text,'?')) || ' · R$ ' || replace(to_char(OLD.valor,'FM9999990.00'),'.',',')
             || case when coalesce(OLD.comprovante_link,'')='' then ' · sem comprovante' else '' end
             || case when OLD.pendente then ' · aguardando análise' else '' end;
  end if;
  if TG_OP <> 'DELETE' then
    d_new := initcap(coalesce(NEW.fase::text,'?')) || ' · R$ ' || replace(to_char(NEW.valor,'FM9999990.00'),'.',',')
             || case when coalesce(NEW.comprovante_link,'')='' then ' · sem comprovante' else '' end
             || case when NEW.pendente then ' · aguardando análise' else '' end;
  end if;
  if TG_OP = 'UPDATE' and d_old is not distinct from d_new then
    -- só o comprovante foi trocado (por outro arquivo)
    if OLD.comprovante_link is distinct from NEW.comprovante_link then
      d_old := d_old || ' · comprovante anterior';
      d_new := d_new || ' · comprovante novo';
    else
      return NEW;                                   -- nada visível mudou (ex.: só reordenou)
    end if;
  end if;

  rid := coalesce(NEW.reembolso_id, OLD.reembolso_id);
  -- solicitação inteira sendo apagada (pedágios saem em cascata): nada a registrar
  if not exists (select 1 from reembolsos where id = rid) then return coalesce(NEW, OLD); end if;
  insert into reembolso_edicoes (reembolso_id, por, alteracoes)
  values (rid, auth.uid(), jsonb_build_array(jsonb_build_object(
    'campo', 'pedagio',
    'de',   coalesce(to_jsonb(d_old), 'null'::jsonb),
    'para', coalesce(to_jsonb(d_new), 'null'::jsonb))));
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_registra_edicao_pedagio on pedagios;
create trigger trg_registra_edicao_pedagio
  after insert or update or delete on pedagios
  for each row execute function fn_registra_edicao_pedagio();

commit;
