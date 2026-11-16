// Origem do visitante: de qual página e de qual anúncio ele chegou. O cadastro no /painel (mesmo domínio)
// lê isto e grava junto da conta, para o admin mostrar quantos cadastros vieram de cada LP.
// Guarda a primeira e a última chegada. Navegar entre páginas do próprio site não troca a última.
(function () {
  try {
    var s = document.currentScript;
    var lp = (s && s.getAttribute('data-lp')) || 'site';
    var q = new URLSearchParams(location.search);
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    var externo = ref && ref !== location.hostname;
    var o = { lp: lp, em: new Date().toISOString() };
    if (ref) o.ref = ref;
    var temAnuncio = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(function (k) {
      var v = q.get(k);
      if (v) { o[k] = v.slice(0, 200); temAnuncio = true; }
    });
    var chave = 'gm_origem';
    var a = JSON.parse(localStorage.getItem(chave) || 'null') || {};
    var pagina = /^(home|lp\d+)$/.test(lp);
    if (!a.primeira) a.primeira = o;
    if (!a.ultima || temAnuncio || externo || (pagina && !ref)) a.ultima = o;
    localStorage.setItem(chave, JSON.stringify(a));
  } catch (e) {}
})();
