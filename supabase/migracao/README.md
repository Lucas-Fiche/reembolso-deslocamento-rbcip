# Migração dos dados — planilha Google → Supabase (Fase 2)

Transforma a planilha atual (`Registros`, `Preços Gasolina`) nas tabelas
normalizadas do Supabase (`reembolsos`, `paradas`, `pedagios`, `precos_gasolina`).

## Como funciona
`importar.py` lê o `.xlsx` exportado do Google Sheets e gera um `seed_migracao.sql`
com todos os `insert`s. Ele:
- decompõe o texto dos **trechos** (`N. origem → destino | km | data | GPS | Maps`)
  em linhas da tabela `paradas`;
- decompõe o texto dos **pedágios** (`N. [FASE] R$ valor | link`) em linhas de `pedagios`
  — inclusive recuperando valores que a planilha corrompeu em "data";
- **não** grava os valores em R$ calculados (o banco recalcula sozinho), mas guarda
  o total original da planilha em `val_total_planilha` para auditoria;
- preserva a data original de cada registro (`criado_em`).

## Uso
```bash
python3 importar.py caminho/para/planilha.xlsx saida/seed_migracao.sql
```

## ⚠️ Privacidade
O `seed_migracao.sql` gerado contém **dados pessoais** (nome, CPF, e-mail) e por isso
está no `.gitignore` — **nunca** deve ser versionado. Ele é entregue diretamente para
ser rodado no SQL Editor do Supabase.

## Ordem de execução no Supabase
1. `migrations/0003_ajustes_fase2.sql` (Parte 1, depois Parte 2)
2. `seed_migracao.sql`
3. Consulta de conferência (ver a mensagem de acompanhamento).
