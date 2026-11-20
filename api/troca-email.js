// /api/troca-email  (20/11/2026)
//
// Pedidos de troca do e-mail de acesso feitos pelo cliente na Central (tabela troca_email,
// sql/005_troca_email.sql da Central). So a equipe autorizada (autorizados.js) usa.
//
//   GET                      -> { pedidos: [...] }  pendentes primeiro, depois os decididos (ultimos 100)
//   POST { id, acao: 'recusar', motivo }  -> recusa (o motivo e obrigatorio; o cliente ve na Central)
//   POST { id, acao: 'aprovar' }          -> aprova:
//        1. confere que o pedido esta pendente e que a conta ainda usa o e-mail atual;
//        2. recusa se o e-mail novo ja e de outra conta ou ja esta no cadastro de outra casa;
//        3. troca o e-mail da conta (login) para o novo, ja confirmado;
//        4. troca o e-mail nas casas do Financeiro (unidades.email_comprador / email_conjuge);
//           se isso falhar, volta o e-mail da conta para o antigo (o cliente nao fica sem entrar);
//        5. marca o pedido como aprovado, com quem decidiu e quantas casas mudaram.
const { responder, sb, tudo, quemPediu } = require('./_comum');

const limpa = (v) => String(v || '').trim().toLowerCase();
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise((ok) => {
    let t = ''; req.on('data', (c) => { t += c; }); req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch (e) { ok({}); } });
  });
}

// todas as contas (Auth admin), de 1000 em 1000
async function contas() {
  const lista = [];
  for (let pagina = 1; pagina < 50; pagina++) {
    const r = await sb('/auth/v1/admin/users?page=' + pagina + '&per_page=1000');
    if (!r.ok) return null;
    const lote = (r.dados && r.dados.users) || [];
    lista.push(...lote);
    if (lote.length < 1000) break;
  }
  return lista;
}

// as casas cujo e-mail (comprador ou conjuge) e este
function casasDoEmail(unidades, email) {
  return unidades.filter((u) => limpa(u.email_comprador) === email || limpa(u.email_conjuge) === email);
}

module.exports = async (req, res) => {
  const quem = await quemPediu(req);
  if (quem.erro) return responder(res, quem.erro[0], { erro: quem.erro[1] });
  try {
    if (req.method === 'GET') {
      const [ped, unid, usu] = await Promise.all([
        sb('/rest/v1/troca_email?select=*&order=criado_em.desc&limit=300'),
        tudo('/rest/v1/unidades?select=id,empreendimento,unidade,comprador,email_comprador,email_conjuge'),
        contas()
      ]);
      if (!ped.ok) {
        if (/troca_email|relation|schema cache/i.test(JSON.stringify(ped.dados || ''))) return responder(res, 409, { erro: 'A troca de e-mail ainda nao foi ligada no banco: rode o sql/005_troca_email.sql da Central no SQL Editor.' });
        return responder(res, 502, { erro: 'Nao consegui ler os pedidos (' + ped.status + ').' });
      }
      if (!unid.ok || !usu) return responder(res, 502, { erro: 'Nao consegui ler as casas ou as contas.' });
      const porId = {}; usu.forEach((u) => { porId[u.id] = u; });
      const lista = (ped.dados || []).map((p) => {
        const u = porId[p.user_id];
        const casas = casasDoEmail(unid.dados, limpa(p.email_atual)).map((c) => ({ id: c.id, unidade: c.unidade, empreendimento: c.empreendimento, comprador: c.comprador }));
        const contaNova = usu.find((x) => limpa(x.email) === limpa(p.email_novo) && x.id !== p.user_id);
        const casaNova = casasDoEmail(unid.dados, limpa(p.email_novo))[0];
        return {
          id: p.id, situacao: p.situacao, email_atual: p.email_atual, email_novo: p.email_novo, motivo: p.motivo,
          criado_em: p.criado_em, decidido_em: p.decidido_em, decidido_por: p.decidido_por, casas_alteradas: p.casas_alteradas,
          nome: (u && u.user_metadata && (u.user_metadata.nome || u.user_metadata.name)) || (casas[0] && casas[0].comprador) || '',
          conta_email: u ? limpa(u.email) : null,
          casas,
          conflito: contaNova ? 'O e-mail novo já é de outra conta.' : casaNova ? 'O e-mail novo já está no cadastro da ' + (casaNova.unidade || 'casa ' + casaNova.id) + '.' : null
        };
      });
      // pendentes primeiro (o mais antigo no topo: e o que espera ha mais tempo); depois os decididos
      const pend = lista.filter((p) => p.situacao === 'pendente').sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
      const outros = lista.filter((p) => p.situacao !== 'pendente').slice(0, 100);
      return responder(res, 200, { pedidos: pend.concat(outros) });
    }

    if (req.method !== 'POST') return responder(res, 405, { erro: 'Use GET ou POST.' });
    const corpo = await lerCorpo(req);
    const id = Number(corpo.id);
    if (!Number.isInteger(id) || id <= 0) return responder(res, 400, { erro: 'Pedido invalido.' });
    const acao = corpo.acao;
    if (acao !== 'aprovar' && acao !== 'recusar') return responder(res, 400, { erro: 'Acao invalida.' });
    const r = await sb('/rest/v1/troca_email?id=eq.' + id + '&select=*');
    const p = r.ok && Array.isArray(r.dados) ? r.dados[0] : null;
    if (!p) return responder(res, 404, { erro: 'Pedido nao encontrado.' });
    if (p.situacao !== 'pendente') return responder(res, 409, { erro: 'Este pedido ja foi decidido (' + p.situacao + ').' });
    const agora = new Date().toISOString();
    const fechar = (campos) => sb('/rest/v1/troca_email?id=eq.' + id + '&situacao=eq.pendente', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: Object.assign({ decidido_em: agora, decidido_por: quem.email }, campos) });

    if (acao === 'recusar') {
      const motivo = String(corpo.motivo || '').trim();
      if (motivo.length < 3) return responder(res, 400, { erro: 'Escreva o motivo da recusa: o cliente vê na Central.' });
      const f = await fechar({ situacao: 'recusada', motivo: motivo.slice(0, 500) });
      if (!f.ok || !Array.isArray(f.dados) || !f.dados.length) return responder(res, 502, { erro: 'Nao consegui gravar a recusa.' });
      return responder(res, 200, { ok: true, situacao: 'recusada' });
    }

    // ---- aprovar
    const atual = limpa(p.email_atual), novo = limpa(p.email_novo);
    if (!EMAIL_OK.test(novo)) return responder(res, 400, { erro: 'O e-mail novo do pedido nao e valido.' });
    const c = await sb('/auth/v1/admin/users/' + encodeURIComponent(p.user_id));
    if (!c.ok || !c.dados || !c.dados.id) return responder(res, 409, { erro: 'A conta do cliente nao existe mais.' });
    if (limpa(c.dados.email) !== atual) return responder(res, 409, { erro: 'O e-mail da conta mudou desde o pedido (agora ' + limpa(c.dados.email) + '). Recuse este pedido.' });
    const [usu, unid] = await Promise.all([contas(), tudo('/rest/v1/unidades?select=id,unidade,email_comprador,email_conjuge')]);
    if (!usu || !unid.ok) return responder(res, 502, { erro: 'Nao consegui conferir as contas e as casas agora.' });
    if (usu.some((x) => limpa(x.email) === novo && x.id !== p.user_id)) return responder(res, 409, { erro: 'O e-mail novo ja e de outra conta. Recuse o pedido ou fale com o cliente.' });
    const ocupada = casasDoEmail(unid.dados, novo)[0];
    if (ocupada) return responder(res, 409, { erro: 'O e-mail novo ja esta no cadastro da ' + (ocupada.unidade || 'casa ' + ocupada.id) + '. Confira no Financeiro antes de aprovar.' });

    // 3. o login
    const t = await sb('/auth/v1/admin/users/' + encodeURIComponent(p.user_id), { method: 'PUT', body: { email: novo, email_confirm: true } });
    if (!t.ok) return responder(res, 502, { erro: 'O Supabase nao aceitou trocar o e-mail da conta (' + t.status + '). Nada foi mudado.' });

    // 4. as casas (comprador e conjuge), pelo id: o e-mail guardado pode ter espacos ou maiusculas
    const idsComprador = unid.dados.filter((u) => limpa(u.email_comprador) === atual).map((u) => u.id);
    const idsConjuge = unid.dados.filter((u) => limpa(u.email_conjuge) === atual).map((u) => u.id);
    let falhou = false;
    if (idsComprador.length) { const a = await sb('/rest/v1/unidades?id=in.(' + idsComprador.join(',') + ')', { method: 'PATCH', body: { email_comprador: novo } }); falhou = falhou || !a.ok; }
    if (!falhou && idsConjuge.length) { const b = await sb('/rest/v1/unidades?id=in.(' + idsConjuge.join(',') + ')', { method: 'PATCH', body: { email_conjuge: novo } }); falhou = falhou || !b.ok; }
    if (falhou) {
      await sb('/auth/v1/admin/users/' + encodeURIComponent(p.user_id), { method: 'PUT', body: { email: atual, email_confirm: true } });
      return responder(res, 502, { erro: 'Nao consegui trocar o e-mail nas casas. O login voltou para o e-mail antigo; tente de novo.' });
    }
    const casas = new Set(idsComprador.concat(idsConjuge)).size;

    // 5. o pedido
    const f = await fechar({ situacao: 'aprovada', casas_alteradas: casas });
    if (!f.ok) return responder(res, 200, { ok: true, situacao: 'aprovada', casas, aviso: 'A troca foi feita, mas o pedido nao foi marcado como aprovado. Atualize a lista.' });
    return responder(res, 200, { ok: true, situacao: 'aprovada', casas });
  } catch (e) {
    return responder(res, 500, { erro: 'Falha inesperada: ' + (e && e.message) });
  }
};
