-- "Limpar" na revisão do Pluggy oculta (não apaga) as linhas ignoradas/confirmadas:
-- ficam no banco pro sync não trazê-las de volta, mas somem da tela.
-- Já aplicada no projeto via MCP; mantida aqui só como registro do schema.
alter table public.transacoes_importadas
  add column if not exists oculta boolean not null default false;
