-- Faturas do banco (Open Finance) por cartão — usadas no app pra conferir o
-- total lançado com o total da fatura (ver renderFaturasCartao em js/ui.js).
-- Já aplicada no projeto via MCP; mantida aqui só como registro do schema.
create table if not exists public.pluggy_faturas (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  conta_id bigint not null references public.pluggy_contas(id) on delete cascade,
  bill_id text not null,
  vencimento date,
  fechamento date,
  total numeric,
  minimo numeric,
  atualizado_em timestamptz not null default now(),
  unique (user_id, bill_id)
);
alter table public.pluggy_faturas enable row level security;
create policy "own pluggy_faturas" on public.pluggy_faturas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
