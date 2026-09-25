-- Nº da parcela e total de parcelas (Pluggy creditCardMetadata) na fila de
-- revisão — usados pra importar a compra parcelada como parcelamento no app.
-- Já aplicada no projeto via MCP; mantida aqui só como registro do schema.
alter table public.transacoes_importadas
  add column if not exists parcela_num integer,
  add column if not exists parcelas_total integer;
