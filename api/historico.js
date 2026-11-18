// GET /api/historico: as ultimas 300 entradas da equipe na conta de clientes
const { responder, sb, quemPediu } = require('./_comum');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Use GET.' });
  const quem = await quemPediu(req);
  if (quem.erro) return responder(res, quem.erro[0], { erro: quem.erro[1] });
  const r = await sb('/rest/v1/bo_acessos?select=quando,equipe_email,cliente_email,cliente_nome&order=quando.desc&limit=300');
  if (!r.ok) return responder(res, 500, { erro: 'Nao consegui ler o historico. Rode o sql/001_backoffice.sql no Supabase.' });
  return responder(res, 200, { acessos: r.dados || [] });
};
