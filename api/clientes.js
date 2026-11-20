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
    const CAMPOS_CASA = 'id,empreendimento,unidade,comprador,status_contrato,valor_venda,saldo_devedor_atual';
    const [vinc, unid, parc] = await Promise.all([
      tudo('/rest/v1/vinculos?select=user_id,unidade_id,situacao,criado_em'),
      tudo('/rest/v1/unidades?select=' + CAMPOS_CASA + ',email_comprador,email_conjuge,cpf_comprador,cpf_conjuge'),
      tudo('/rest/v1/parcelas?select=unidade_id,pago,data_vencimento')
    ]);
    if (!vinc.ok || !unid.ok || !parc.ok) {
      // sem as colunas de CPF (sql/004) ou de e-mail (sql/003) da Central, le as casas com o que houver
      let unid2 = unid.ok ? unid : await tudo('/rest/v1/unidades?select=' + CAMPOS_CASA + ',email_comprador,email_conjuge');
      if (!unid2.ok) unid2 = await tudo('/rest/v1/unidades?select=' + CAMPOS_CASA);
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

    // o casaPorId deixa de levar e-mail e CPF para a tela (so servem para achar quem ainda nao entrou)
    Object.values(casaPorId).forEach((c) => { delete c.email_comprador; delete c.email_conjuge; delete c.cpf_comprador; delete c.cpf_conjuge; });
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
    });

    // 4. (20/11/2026) quem esta cadastrado nas casas (e-mail do comprador ou do conjuge) e ainda
    //    nao tem conta: com o login por e-mail + CPF, a conta so nasce no primeiro acesso a Central.
    //    Antes eles nao apareciam ("so 18 cadastros"). Vem com sem_login e as casas desse e-mail.
    const comConta = new Set(clientes.map((c) => c.email));
    const cadastro = {};
    unid.dados.forEach((u) => {
      [['email_comprador', 'cpf_comprador', u.comprador], ['email_conjuge', 'cpf_conjuge', '']].forEach(([ce, cc, nome]) => {
        const e = String(u[ce] || '').trim().toLowerCase();
        if (!e || comConta.has(e)) return;
        const p = cadastro[e] || (cadastro[e] = { email: e, nome: '', semCpf: false, casas: [] });
        if (nome && !p.nome) p.nome = String(nome).trim();
        if (cc in u && !u[cc]) p.semCpf = true;   // sem CPF a pessoa nao consegue entrar (o CPF e a senha)
        if (!p.casas.some((x) => x.id === u.id)) p.casas.push(Object.assign({ situacao: 'cadastro' }, casaPorId[u.id] || { id: u.id }));
      });
    });
    Object.values(cadastro).forEach((p) => clientes.push({
      id: 'cadastro:' + p.email, email: p.email, nome: p.nome, criado_em: null, confirmado_em: null, ultimo_acesso: null,
      equipe: emailsEquipe.has(p.email), sem_login: true, sem_cpf: p.semCpf, casas: p.casas
    }));
    // contas mais novas primeiro; quem ainda nao entrou vem depois, por nome
    clientes.sort((a, b) => (a.sem_login === b.sem_login)
      ? (a.sem_login ? String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR') : String(b.criado_em).localeCompare(String(a.criado_em)))
      : (a.sem_login ? 1 : -1));
    return responder(res, 200, { clientes, quem: quem.email });
  } catch (e) {
    return responder(res, 500, { erro: 'Falha inesperada: ' + (e && e.message) });
  }
};
