-- Funcionalidade de lançamentos recorrentes removida
select cron.unschedule('lembretes-recorrentes');
drop table if exists public.recorrentes;
