// GET /api/clientes: todas as contas de login com os dados da Central (casas, saldo, parcelas)
// e a marca "equipe" para quem trabalha na DPR (Financeiro, obras, CRM, backoffice da Ana).
const { responder, sb, tudo, quemPediu } = require('./_comum');

const LIBERADO = /^\s*(liberad[oa]|liberar|sim|ok)\s*$/i;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return responder(res, 405, { erro: 'Use GET.' });
  const quem = await quemPediu(req);
  if (quem.erro) return responder(res, quem.erro[0], { erro: quem.erro[1] });
  try {
    // 1. as contas (Auth admin), de 1000 em 1000
    const usuarios = [];
    for (let pagina = 1; pagina < 50; pagina++) {
      const r = await sb('/auth/v1/admin/users?page=' + pagina + '&per_page=1000');
      if (!r.ok) return responder(res, 502, { erro: 'Nao consegui ler as contas do Supabase (' + r.status + ').' });
      const lote = (r.dados && r.dados.users) || [];
      usuarios.push(...lote);
      if (lote.length < 1000) break;
    }
    // 2. vinculos, casas e parcelas
    const [vinc, unid, parc] = await Promise.all([
      tudo('/rest/v1/vinculos?select=user_id,unidade_id,situacao,criado_em'),
      tudo('/rest/v1/unidades?select=id,empreendimento,unidade,comprador,status_contrato,valor_venda,saldo_devedor_atual,email_comprador,email_conjuge'),
      tudo('/rest/v1/parcelas?select=unidade_id,pago,data_vencimento')
    ]);
    if (!vinc.ok || !unid.ok || !parc.ok) {
      // sem as colunas de e-mail (sql/003 da Central), le as casas sem elas
      const unid2 = unid.ok ? unid : await tudo('/rest/v1/unidades?select=id,empreendimento,unidade,comprador,status_contrato,valor_venda,saldo_devedor_atual');
      if (!vinc.ok || !unid2.ok || !parc.ok) return responder(res, 502, { erro: 'Nao consegui ler vinculos, casas ou parcelas.' });
      unid.dados = unid2.dados; unid.ok = true;
    }
    // 3. quem e equipe (tabelas que podem nao existir: erro vira lista vazia)
    const [fin, obr, crm, ia] = await Promise.all([
      tudo('/rest/v1/fin_liberacoes?select=email,liberado'),
      tudo('/rest/v1/obras_perfis?select=user_id'),
      tudo('/rest/v1/crm_perfis?select=user_id'),
      tudo('/rest/v1/ia_liberacoes?select=email')
    ]);
    const emailsEquipe = new Set();
    (fin.ok ? fin.dados : []).forEach((x) => { if (LIBERADO.test(String(x.liberado || ''))) emailsEquipe.add(String(x.email || '').toLowerCase()); });
    (ia.ok ? ia.dados : []).forEach((x) => emailsEquipe.add(String(x.email || '').toLowerCase()));
    const idsEquipe = new Set([...(obr.ok ? obr.dados : []), ...(crm.ok ? crm.dados : [])].map((x) => x.user_id));

    const hoje = new Date().toISOString().slice(0, 10);
    const casaPorId = {};
    unid.dados.forEach((u) => { casaPorId[u.id] = Object.assign({}, u, { parcelas: 0, pagas: 0, atrasadas: 0 }); });
    parc.dados.forEach((p) => {
      const c = casaPorId[p.unidade_id]; if (!c) return;
      c.parcelas++;
      if (p.pago) c.pagas++;
      else if (p.data_vencimento && String(p.data_vencimento).slice(0, 10) < hoje) c.atrasadas++;
    });
    const vincPorUser = {};
    vinc.dados.forEach((v) => { (vincPorUser[v.user_id] = vincPorUser[v.user_id] || []).push(v); });

    const clientes = usuarios.map((u) => {
      const email = String(u.email || '').toLowerCase();
      const casas = (vincPorUser[u.id] || []).map((v) => Object.assign({ situacao: v.situacao, pedido_em: v.criado_em }, casaPorId[v.unidade_id] || { id: v.unidade_id }));
      return {
        id: u.id,
        email,
        nome: (u.user_metadata && (u.user_metadata.nome || u.user_metadata.name)) || '',
        criado_em: u.created_at,
        confirmado_em: u.email_confirmed_at || null,
        ultimo_acesso: u.last_sign_in_at || null,
        equipe: emailsEquipe.has(email) || idsEquipe.has(u.id),
        casas
      };
    }).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
    return responder(res, 200, { clientes, quem: quem.email });
  } catch (e) {
    return responder(res, 500, { erro: 'Falha inesperada: ' + (e && e.message) });
  }
};
