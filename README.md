# Clientes da Central DPR (backoffice)

Painel da equipe da DPR para ver **todas as contas cadastradas na Central do Cliente** e, quando
precisar, **entrar na Central como o cliente**, sem saber a senha dele.

## O que tem
- **Clientes:** lista com busca e filtros (confirmaram o código, sem confirmar, sem casa liberada,
  com parcela em atraso). As contas da equipe ficam escondidas (marque "Mostrar contas da equipe").
- **Ficha do cliente:** cadastro, confirmação do e-mail, último acesso, casas ligadas (acesso,
  contrato, comprador, saldo, parcelas pagas e em atraso).
- **Entrar na Central como este cliente:** gera um link de entrada de uso único (sem mandar e-mail
  ao cliente) e abre a Central numa aba nova, já na conta dele. Só para quem já confirmou o e-mail.
- **Histórico de acessos:** quem da equipe entrou na conta de qual cliente, e quando.

## Quem pode usar
Os e-mails em `autorizados.js`. A pessoa entra com a conta normal dela do Supabase (a mesma do
Financeiro). **Senha nunca vai no código** (o repositório é público). O servidor confere o e-mail
antes de mostrar qualquer cliente.

## Arquivos
- `index.html`: a página.
- `autorizados.js`: os e-mails que podem usar o backoffice.
- `api/clientes.js`, `api/entrar-como.js`, `api/historico.js`: funções da Vercel (usam a chave de
  serviço do Supabase, que fica só na Vercel).
- `sql/001_backoffice.sql`: a tabela do histórico.

## Para colocar no ar (uma vez)
1. **Supabase > SQL Editor:** rodar `sql/001_backoffice.sql`.
2. **Supabase > Authentication > URL Configuration > Redirect URLs:** incluir o endereço da Central
   (ex.: `https://centraldpr.vercel.app/**` e, para testar, o do preview da Central).
3. **Vercel:** criar o projeto a partir deste repositório (time `tecdpr`) e, em
   Settings > Environment Variables, criar:
   - `SUPABASE_URL` = `https://roashkfdjgsweuftqhyx.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = a chave `service_role` (Supabase > Project Settings > API Keys).
     **Cole direto na Vercel; não mande por mensagem e não coloque no código.**
   - `CENTRAL_URL` = o endereço da Central que deve abrir (produção ou preview).
4. Fazer um novo deploy para as variáveis valerem.
