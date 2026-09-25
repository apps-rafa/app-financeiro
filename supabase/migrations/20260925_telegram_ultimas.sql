-- Últimas transações mostradas pelo /atualizar (numeradas 1..12) pra o toque no número virar rascunho
create table if not exists public.telegram_ultimas (
  chat_id bigint primary key,
  user_id uuid not null,
  itens jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);
alter table public.telegram_ultimas enable row level security;
