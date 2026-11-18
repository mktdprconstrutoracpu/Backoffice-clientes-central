/* ============================================================================
   QUEM PODE USAR O BACKOFFICE DE CLIENTES
   Um e-mail por linha, entre aspas, com virgula no fim. A pessoa entra com a
   conta normal dela do Supabase (a mesma do Financeiro). SENHA NUNCA vai aqui:
   este repositorio e publico; a senha fica so no Supabase.
   Quem ler este arquivo nao ganha acesso: o servidor (api/) confere o login
   de verdade antes de mostrar qualquer cliente ou abrir a Central de alguem.
   ============================================================================ */
(function () {
  var AUTORIZADOS = [
    'luereio_2@hotmail.com',
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = AUTORIZADOS;
  else window.AUTORIZADOS = AUTORIZADOS;
})();
