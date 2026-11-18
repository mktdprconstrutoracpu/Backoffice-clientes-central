// Comum as funcoes do backoffice (Vercel, Node 18+, sem dependencias).
// Variaveis de ambiente (na Vercel, NUNCA no codigo):
//   SUPABASE_URL               https://roashkfdjgsweuftqhyx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  a chave de servico (service_role) do projeto
//   CENTRAL_URL                endereco da Central, ex.: https://centraldpr.vercel.app
const AUTORIZADOS = require('../autorizados.js');

const URL_SB = (process.env.SUPABASE_URL || 'https://roashkfdjgsweuftqhyx.supabase.co').replace(/\/$/, '');
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

// chamada ao Supabase com a chave de servico
async function sb(caminho, opcoes) {
  const o = opcoes || {};
  const r = await fetch(URL_SB + caminho, {
    method: o.method || 'GET',
    headers: Object.assign({ apikey: CHAVE, Authorization: 'Bearer ' + CHAVE, 'Content-Type': 'application/json' }, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = texto; }
  return { ok: r.ok, status: r.status, dados };
}

// le uma tabela inteira, de 1000 em 1000 (o PostgREST corta em 1000 linhas)
async function tudo(caminho) {
  const saida = [];
  for (let de = 0; ; de += 1000) {
    const r = await sb(caminho, { headers: { Range: de + '-' + (de + 999), 'Range-Unit': 'items' } });
    if (!r.ok) return { ok: false, status: r.status, dados: r.dados };
    const lote = Array.isArray(r.dados) ? r.dados : [];
    saida.push(...lote);
    if (lote.length < 1000) break;
  }
  return { ok: true, dados: saida };
}

// confere quem chamou: o token do login (Supabase) e o e-mail na lista de autorizados
async function quemPediu(req) {
  if (!CHAVE) return { erro: [500, 'A chave de servico do Supabase nao esta configurada na Vercel (SUPABASE_SERVICE_ROLE_KEY).'] };
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { erro: [401, 'Entre no backoffice.'] };
  const r = await fetch(URL_SB + '/auth/v1/user', { headers: { apikey: CHAVE, Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    // o Supabase recusa tanto login vencido quanto chave errada; separa os dois para a mensagem nao enganar
    const texto = await r.text().catch(() => '');
    // login vencido/ruim: 403 com "bad_jwt" ou "session_not_found"; chave errada: 401 vazio ou "Invalid API key"
    if (!/jwt|session|token/i.test(texto)) return { erro: [500, 'A chave de servico do Supabase na Vercel (SUPABASE_SERVICE_ROLE_KEY) esta errada.'] };
    return { erro: [401, 'Sessao vencida. Entre de novo.'] };
  }
  const u = await r.json();
  const email = String(u.email || '').trim().toLowerCase();
  const lista = AUTORIZADOS.map((e) => String(e).trim().toLowerCase());
  if (!email || lista.indexOf(email) < 0) return { erro: [403, 'Este e-mail nao esta autorizado no backoffice.'] };
  return { email, id: u.id };
}

module.exports = { responder, sb, tudo, quemPediu, AUTORIZADOS };
