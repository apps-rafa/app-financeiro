-- Recorrentes (lembrete no Telegram), tarefas agendadas (pg_cron) e alertas de erro do bot.
-- Aplicada via MCP; o segredo é gerado no banco (não fica no repositório).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.recorrentes (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descricao text not null default '',
  tipo text not null check (tipo in ('entradas','saidas')),
  valor numeric(12,2) not null check (valor > 0),
  categoria text not null,
  metodo text,
  dia_mes smallint not null check (dia_mes between 1 and 31),
  ativo boolean not null default true,
  ultimo_lembrete date,
  criado_em timestamptz not null default now()
);
alter table public.recorrentes enable row level security;
create policy "own recorrentes" on public.recorrentes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.app_cron_segredo (nome text primary key, valor text not null);
alter table public.app_cron_segredo enable row level security;
insert into public.app_cron_segredo (nome, valor) values ('tarefas', encode(gen_random_bytes(24), 'hex')) on conflict (nome) do nothing;

create table if not exists public.alertas_bot (chave text primary key, enviado_em timestamptz not null default now());
alter table public.alertas_bot enable row level security;

-- Lembretes: todo dia 12:00 UTC (09:00 em Brasília). Backup: domingo 11:00 UTC (08:00).
select cron.schedule('lembretes-recorrentes', '0 12 * * *', $$
  select net.http_post(url := 'https://hhmuqgkabknquvhxafmf.supabase.co/functions/v1/telegram-webhook',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select valor from public.app_cron_segredo where nome='tarefas')),
    body := '{"tarefa":"lembretes"}'::jsonb);
$$);
select cron.schedule('backup-semanal', '0 11 * * 0', $$
  select net.http_post(url := 'https://hhmuqgkabknquvhxafmf.supabase.co/functions/v1/telegram-webhook',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select valor from public.app_cron_segredo where nome='tarefas')),
    body := '{"tarefa":"backup"}'::jsonb);
$$);
