// /api/conversas  (20/11/2026)
//
// O chat da Central (a "Ana, da DPR", sem IA paga: responde por roteiro) visto pela equipe.
// Tabelas: sql/006_assistente.sql e sql/007_chat_roteiro.sql da Central. So a equipe autorizada usa.
//
//   GET                     -> { robo_ligado, conversas: [...] }  aguardando a equipe primeiro (a mais
//                              antiga no topo), depois as outras pela ultima mensagem. Cada uma traz o
//                              telefone da casa (unidades.telefone do Financeiro) e se ha mensagem nao lida.
//   GET ?user=<user_id>     -> { conversa, mensagens }  as ultimas 200 falas; marca a conversa como lida
//   POST { acao: 'responder', user_id, texto, pausar }  a equipe responde (e, com pausar, pausa o robo nela)
//   POST { acao: 'pausar' | 'retomar', user_id }         robo desta conversa
//   POST { acao: 'resolver', user_id }                   tira de "aguardando a equipe" sem responder
//   POST { acao: 'robo', ligado: true | false }          interruptor geral do robo (todas as conversas)
const { responder, sb, tudo, quemPediu } = require('./_comum');

const limpa = (v) => String(v || '').trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const semTabela = (r) => /assistente_|relation|schema cache/i.test(JSON.stringify((r && r.dados) || ''));
const AVISO_SQL = 'O chat ainda nao foi ligado no banco: rode o sql/006_assistente.sql e o sql/007_chat_roteiro.sql da Central no SQL Editor.';

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise((ok) => {
    let t = ''; req.on('data', (c) => { t += c; }); req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch (e) { ok({}); } });
  });
}
const falhaBanco = (res, r, oque) => responder(res, semTabela(r) ? 409 : 502, { erro: semTabela(r) ? AVISO_SQL : 'Nao consegui ' + oque + ' (' + r.status + ').' });
const naoLida = (c) => c.ultima_papel === 'cliente' && !!c.ultima_em && (!c.lida_equipe_em || String(c.ultima_em) > String(c.lida_equipe_em));

module.exports = async (req, res) => {
  const quem = await quemPediu(req);
  if (quem.erro) return responder(res, quem.erro[0], { erro: quem.erro[1] });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const user = url.searchParams.get('user');
      if (user != null) {
        if (!UUID.test(user)) return responder(res, 400, { erro: 'Cliente invalido.' });
        const [c, m] = await Promise.all([
          sb('/rest/v1/assistente_conversas?select=*&user_id=eq.' + user),
          sb('/rest/v1/assistente_mensagens?select=id,papel,texto,autor,criado_em&user_id=eq.' + user + '&order=id.desc&limit=200')
        ]);
        if (!c.ok) return falhaBanco(res, c, 'ler a conversa');
        if (!m.ok) return falhaBanco(res, m, 'ler as mensagens');
        const conversa = (c.dados || [])[0];
        if (!conversa) return responder(res, 404, { erro: 'Conversa nao encontrada.' });
        await sb('/rest/v1/assistente_conversas?user_id=eq.' + user, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { lida_equipe_em: new Date().toISOString() } });
        return responder(res, 200, { conversa, mensagens: (m.dados || []).reverse() });
      }
      const [c, cfg, unid] = await Promise.all([
        sb('/rest/v1/assistente_conversas?select=*&order=ultima_em.desc.nullslast&limit=500'),
        sb('/rest/v1/assistente_config?select=valor&chave=eq.robo_ligado'),
        tudo('/rest/v1/unidades?select=email_comprador,email_conjuge,telefone')
      ]);
      if (!c.ok) return falhaBanco(res, c, 'ler as conversas');
      if (!cfg.ok) return falhaBanco(res, cfg, 'ler o interruptor do robo');
      const casas = unid.ok ? unid.dados : [];   // sem a coluna telefone: a lista sai sem telefone
      const lista = (c.dados || []).map((x) => {
        const email = limpa(x.email);
        const tel = casas.filter((u) => limpa(u.email_comprador) === email || limpa(u.email_conjuge) === email).map((u) => String(u.telefone || '').replace(/\D/g, '')).find((t) => t.length >= 10) || null;
        return Object.assign({}, x, { nao_lida: naoLida(x), telefone: tel });
      });
      const aguardando = lista.filter((x) => x.aguardando_equipe).sort((a, b) => String(a.aguardando_desde || a.ultima_em).localeCompare(String(b.aguardando_desde || b.ultima_em)));
      const outras = lista.filter((x) => !x.aguardando_equipe);
      const v = (cfg.dados || [])[0];
      return responder(res, 200, { robo_ligado: !v || v.valor !== 'nao', conversas: aguardando.concat(outras) });
    }

    if (req.method !== 'POST') return responder(res, 405, { erro: 'Use GET ou POST.' });
    const corpo = await lerCorpo(req);
    const acao = corpo.acao;
    const agora = new Date().toISOString();

    if (acao === 'robo') {
      if (typeof corpo.ligado !== 'boolean') return responder(res, 400, { erro: 'Diga se o robo fica ligado ou desligado.' });
      const r = await sb('/rest/v1/assistente_config?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { chave: 'robo_ligado', valor: corpo.ligado ? 'sim' : 'nao' } });
      if (!r.ok) return falhaBanco(res, r, 'gravar o interruptor');
      return responder(res, 200, { ok: true, robo_ligado: corpo.ligado });
    }

    const user = String(corpo.user_id || '');
    if (!UUID.test(user)) return responder(res, 400, { erro: 'Cliente invalido.' });
    const mudar = async (campos) => {
      const r = await sb('/rest/v1/assistente_conversas?user_id=eq.' + user, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: campos });
      if (!r.ok) return { erro: r };
      if (!Array.isArray(r.dados) || !r.dados.length) return { naoAchou: true };
      return { conversa: r.dados[0] };
    };

    if (acao === 'pausar' || acao === 'retomar' || acao === 'resolver') {
      const campos = acao === 'pausar' ? { robo_pausado: true, pausado_por: quem.email, pausado_em: agora }
        : acao === 'retomar' ? { robo_pausado: false, pausado_por: null, pausado_em: null }
        : { aguardando_equipe: false, aguardando_desde: null };
      const m = await mudar(campos);
      if (m.erro) return falhaBanco(res, m.erro, 'gravar');
      if (m.naoAchou) return responder(res, 404, { erro: 'Conversa nao encontrada.' });
      return responder(res, 200, { ok: true, conversa: m.conversa });
    }

    if (acao === 'responder') {
      const texto = String(corpo.texto || '').trim();
      if (!texto) return responder(res, 400, { erro: 'Escreva a resposta.' });
      if (texto.length > 2000) return responder(res, 400, { erro: 'A resposta passou de 2000 caracteres.' });
      const c = await sb('/rest/v1/assistente_conversas?select=user_id&user_id=eq.' + user);
      if (!c.ok) return falhaBanco(res, c, 'ler a conversa');
      if (!(c.dados || []).length) return responder(res, 404, { erro: 'Conversa nao encontrada.' });
      const g = await sb('/rest/v1/assistente_mensagens?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { user_id: user, papel: 'equipe', texto, autor: quem.email } });
      if (!g.ok) return falhaBanco(res, g, 'gravar a resposta');
      const campos = { ultima_em: agora, ultima_texto: texto.slice(0, 300), ultima_papel: 'equipe', aguardando_equipe: false, aguardando_desde: null, lida_equipe_em: agora };
      if (corpo.pausar === true) Object.assign(campos, { robo_pausado: true, pausado_por: quem.email, pausado_em: agora });
      const m = await mudar(campos);
      if (m.erro) return responder(res, 200, { ok: true, aviso: 'A resposta foi enviada, mas a conversa nao foi atualizada. Atualize a lista.' });
      return responder(res, 200, { ok: true, conversa: m.conversa });
    }

    return responder(res, 400, { erro: 'Acao invalida.' });
  } catch (e) {
    return responder(res, 500, { erro: 'Falha inesperada: ' + (e && e.message) });
  }
};
