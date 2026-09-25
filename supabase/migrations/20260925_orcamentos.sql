-- Orçamento mensal por categoria de despesa (Visão anual): um valor por
-- categoria, vale pra todos os meses.
create table if not exists public.orcamentos (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria text not null,
  valor numeric(12,2) not null check (valor > 0),
  criado_em timestamptz not null default now(),
  unique (user_id, categoria)
);
alter table public.orcamentos enable row level security;
create policy "own orcamentos" on public.orcamentos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
