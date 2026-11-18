// POST /api/entrar-como { id }: gera um link de entrada de uso unico para a conta do cliente
// (magic link do Supabase, sem mandar e-mail), grava no historico e devolve o link.
// Conta que ainda nao confirmou o e-mail (codigo) NAO pode: o link confirmaria o e-mail
// sozinho, e alguem que cadastrou o e-mail de outra pessoa ganharia a casa dela.
const { responder, sb, quemPediu } = require('./_comum');

const CENTRAL = (process.env.CENTRAL_URL || 'https://centraldpr.vercel.app').replace(/\/$/, '');

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((ok) => {
    let t = ''; req.on('data', (c) => { t += c; }); req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch (e) { ok({}); } });
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Use POST.' });
  const quem = await quemPediu(req);
  if (quem.erro) return responder(res, quem.erro[0], { erro: quem.erro[1] });
  const corpo = await lerCorpo(req);
  const id = String(corpo.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return responder(res, 400, { erro: 'Cliente invalido.' });
  try {
    const u = await sb('/auth/v1/admin/users/' + id);
    if (!u.ok || !u.dados || !u.dados.email) return responder(res, 404, { erro: 'Nao achei esta conta.' });
    if (!u.dados.email_confirmed_at) return responder(res, 409, { erro: 'Este cliente ainda nao confirmou o e-mail com o codigo. Sem a confirmacao, nao da para entrar na conta dele.' });
    const nome = (u.dados.user_metadata && (u.dados.user_metadata.nome || u.dados.user_metadata.name)) || null;

    // historico primeiro: sem registro, sem acesso
    const h = await sb('/rest/v1/bo_acessos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { equipe_email: quem.email, cliente_id: id, cliente_email: u.dados.email, cliente_nome: nome } });
    if (!h.ok) return responder(res, 500, { erro: 'Nao consegui gravar o historico. Rode o sql/001_backoffice.sql no Supabase.' });

    const g = await sb('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email: u.dados.email, redirect_to: CENTRAL + '/?visao=equipe' } });
    const link = g.ok && g.dados && (g.dados.action_link || (g.dados.properties && g.dados.properties.action_link));
    if (!link) return responder(res, 502, { erro: 'O Supabase nao gerou o link de entrada (' + g.status + ').' });
    return responder(res, 200, { link, cliente: u.dados.email });
  } catch (e) {
    return responder(res, 500, { erro: 'Falha inesperada: ' + (e && e.message) });
  }
};
