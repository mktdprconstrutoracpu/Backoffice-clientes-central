-- ============================================================================
-- 001_backoffice.sql  (18/11/2026)  Backoffice de clientes da Central DPR
--
-- O historico de "Entrar como este cliente": cada vez que alguem da equipe
-- abre a Central na conta de um cliente, fica gravado quem, de quem e quando.
--
-- So o servidor do backoffice (api/, com a chave de servico guardada na
-- Vercel) le e grava aqui. Ninguem pelo navegador: RLS ligado e sem politica.
--
-- Rode no SQL Editor do Supabase (projeto da Central). Pode rodar de novo.
-- ============================================================================

create table if not exists public.bo_acessos (
  id             bigint generated always as identity primary key,
  quando         timestamptz not null default now(),
  equipe_email   text not null,
  cliente_id     uuid not null,
  cliente_email  text not null,
  cliente_nome   text
);

create index if not exists bo_acessos_quando_idx on public.bo_acessos (quando desc);

alter table public.bo_acessos enable row level security;
revoke all on public.bo_acessos from anon, authenticated;
