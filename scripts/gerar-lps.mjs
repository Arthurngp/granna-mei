// Gera as páginas de dor do MEI em site/mei/<slug>.html, indexáveis, e tudo que depende delas.
// Uso: node scripts/gerar-lps.mjs   (rodar de novo sempre que a home, a copy ou o SEO mudarem)
//
// Fontes: site/index.html (molde), scripts/lps-dados.mjs (copy de lp4 a lp33), site/lp2.html e site/lp3.html
// (feitas à mão) e scripts/seo-lps.mjs (endereço, título de busca, descrição e guia de cada uma).
// Saídas: site/mei/*.html, site/mei/index.html (página de guias), site/lps-redirects.inc (/lpN -> /mei/slug, 301,
// com a UTM junto), site/sitemap.xml e site/llms.txt.
// Cada troca precisa achar o trecho exato. Se algo sumir do molde, o script para com erro.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LPS } from './lps-dados.mjs'
import { SEO } from './seo-lps.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'site')
const BASE = 'https://grannamei.amplasoft.me'
const HOJE = new Date().toISOString().slice(0, 10)
const ler = (f) => readFileSync(join(raiz, f), 'utf8')
const home = ler('index.html')

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const limpa = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>\n`

function troca(s, de, para, vezes = 1) {
  const n = s.split(de).length - 1
  if (n !== vezes) throw new Error(`trecho achado ${n}x (esperado ${vezes}): ${String(de).slice(0, 90)}`)
  return s.split(de).join(para)
}
function trocaRe(s, re, para) {
  if (!re.test(s)) throw new Error(`padrão não achado: ${re}`)
  return s.replace(re, para)
}

// ---------- 1. Copy de cada dor (lp4 a lp33) aplicada no molde da home ----------
const FITA = ['paguei 89 de luz', 'aluguel 900 todo dia 10', 'comprei 1.200 de material em 4x', 'a Bia me deve 150 pra sexta', 'quanto gastei esse mês?', 'paguei a fatura do cartão']

function montarLp(lp) {
  let s = home
  s = s.replace(/<script type="application\/ld\+json">.*?<\/script>\n/gs, '')
  s = troca(s, '<script src="/origem.js" data-lp="home"></script>', `<script src="/origem.js" data-lp="${lp.slug}"></script>`)
  s = troca(s, '>Para MEI · o dinheiro do negócio em dia</p>', '>Para MEI · teste grátis</p>')
  s = troca(s, 'Seu financeiro <span style="color:#8FE9B8;white-space:nowrap">no WhatsApp.</span></h1>', `${esc(lp.h1[0])} <span style="color:#8FE9B8">${esc(lp.h1[1])}</span></h1>`)
  s = troca(s, 'font-size:clamp(52px,7.4vw,104px);line-height:.92', 'font-size:clamp(40px,5.4vw,78px);line-height:.96')
  s = troca(s, '>Você manda uma mensagem e a Granninha anota. Entradas, gastos, contas a pagar e o limite do MEI, sem planilha e sem aplicativo novo.</p>', `>${esc(lp.sub)}</p>`)
  s = troca(s, 'max-width:84%">Recebi 150 da Juliana no pix</div>', `max-width:84%">${esc(lp.chat[0])}</div>`)
  s = troca(s, 'white-space:pre-line">Anotado: entrada de R$ 150,00\nServiços · Conta do banco · hoje\n\nErrou? Responda DESFAZER.</div>', `white-space:pre-line">${esc(lp.chat[1])}</div>`)
  s = troca(s, 'max-width:84%">Quanto sobrou esse mês?</div>', `max-width:84%">${esc(lp.chat[2])}</div>`)
  s = troca(s, 'max-width:88%">Entrou R$ 4.280,00 e saiu R$ 1.930,00. Sobrou R$ 2.350,00. Está indo bem!</div>', `max-width:88%;white-space:pre-line">${esc(lp.chat[3])}</div>`)
  // faixa em duas etapas, para uma frase nova igual a uma antiga não ser trocada de novo
  FITA.forEach((f, i) => { s = troca(s, `“${f}”`, `“@@FITA${i}@@”`, 2) })
  FITA.forEach((_, i) => { s = troca(s, `@@FITA${i}@@`, esc(lp.fita[i]), 2) })
  s = troca(s, '>Exemplo de resposta da Granninha</p>', `>${esc(lp.contaKicker ?? 'Você pergunta “quanto sobrou?” e a Granninha responde')}</p>`)
  s = troca(s, 'Pergunte “quanto sobrou?” e receba o mês inteiro numa linha.</h2>', `${esc(lp.contaH2)}</h2>`)
  s = troca(s, '>Simples como mandar mensagem</h2>', `>${esc(lp.comoH2)}</h2>`)
  s = troca(s, '<h3 style="font-size:22px">Mande do seu jeito</h3>\n          <p style="color:#4E557A;margin-top:8px">Por texto, áudio, foto do comprovante ou PDF. A Granninha entende e anota na hora.</p>',
    `<h3 style="font-size:22px">${esc(lp.passo2[0])}</h3>\n          <p style="color:#4E557A;margin-top:8px">${esc(lp.passo2[1])}</p>`)
  s = troca(s, '<details><summary>Preciso instalar algum aplicativo?</summary>', `<details><summary>${esc(lp.faq[0])}</summary><p>${esc(lp.faq[1])}</p></details>\n        <details><summary>Preciso instalar algum aplicativo?</summary>`)
  s = troca(s, 'Comece hoje e veja quanto sobra no fim do mês.</h2>', `${esc(lp.final)}</h2>`)
  return s
}

// ---------- 2. SEO de cauda longa: cabeçalho indexável, guia e dados estruturados ----------
function aplicarSeo(s, chave, seo) {
  const url = `${BASE}/mei/${seo.slug}`
  s = trocaRe(s, /<title>.*?<\/title>/, `<title>${esc(seo.titulo)} | Granninha</title>`)
  s = trocaRe(s, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(seo.desc)}" />`)
  s = trocaRe(s, /<meta name="robots" content="[^"]*" \/>\n(<link rel="canonical"[^>]*>\n)?/, `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />\n<link rel="canonical" href="${url}" />\n`)
  s = trocaRe(s, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
  s = trocaRe(s, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(seo.titulo)}" />`)
  s = trocaRe(s, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(seo.desc)}" />`)
  s = s.replace(/<script type="application\/ld\+json">.*?<\/script>\n/gs, '')
  const [h2, ps] = seo.guia
  const guia = `<!-- GUIA -->
<section id="guia" style="padding:96px 0 8px">
  <div class="wrap">
    <p class="mono" style="font-size:13px;color:#4E557A">Guia rápido</p>
    <h2 class="disp" style="font-size:clamp(30px,4vw,52px);line-height:1.02;margin-top:14px;max-width:880px">${esc(h2)}</h2>
    <div style="max-width:760px;margin-top:28px;display:flex;flex-direction:column;gap:16px;font-size:18px;color:#33395c;line-height:1.65">
${ps.map((p) => `      <p>${esc(p)}</p>`).join('\n')}
    </div>
    <p style="margin-top:28px"><a href="/mei/" style="font-weight:700;color:#0E8250">Ver todos os guias do financeiro do MEI</a></p>
  </div>
</section>

<!-- FAQ -->`
  s = troca(s, '<!-- FAQ -->', guia)
  // FAQ visível vira FAQPage (as respostas que mudam por data ficam fora)
  const perguntas = [...s.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)]
    .filter((m) => !m[2].includes('data-fora'))
    .map((m) => ({ '@type': 'Question', name: limpa(m[1]), acceptedAnswer: { '@type': 'Answer', text: limpa(m[2]) } }))
  const dados =
    ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'Guias para MEI', item: `${BASE}/mei/` },
      { '@type': 'ListItem', position: 3, name: seo.titulo, item: url }] }) +
    ld({ '@context': 'https://schema.org', '@type': 'Article', headline: seo.titulo, description: seo.desc, inLanguage: 'pt-BR', mainEntityOfPage: url,
      dateModified: HOJE, author: { '@type': 'Organization', name: 'Granninha', url: `${BASE}/` }, publisher: { '@type': 'Organization', name: 'Granninha', logo: { '@type': 'ImageObject', url: `${BASE}/img/logo-512.png` } } }) +
    ld({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: perguntas })
  s = troca(s, '</head>', dados + '</head>')
  return s
}

mkdirSync(join(raiz, 'mei'), { recursive: true })
const paginas = []
const fontes = [['lp2', ler('lp2.html')], ['lp3', ler('lp3.html')], ...LPS.map((lp) => [lp.slug, montarLp(lp)])]
for (const [chave, html] of fontes) {
  const seo = SEO[chave]
  if (!seo) throw new Error(`sem SEO para ${chave}`)
  writeFileSync(join(raiz, 'mei', `${seo.slug}.html`), aplicarSeo(html, chave, seo))
  paginas.push({ chave, ...seo })
  console.log(`${chave} -> /mei/${seo.slug}`)
}

// ---------- 3. Página de guias (/mei/), a partir da página Como funciona ----------
const GRUPOS = [
  ['Organizar o dinheiro do negócio', ['lp2', 'lp3', 'lp4', 'lp15', 'lp21', 'lp8', 'lp9', 'lp19', 'lp23', 'lp18']],
  ['Contas, impostos e obrigações do MEI', ['lp5', 'lp6', 'lp7', 'lp16', 'lp17', 'lp11', 'lp14', 'lp20', 'lp22']],
  ['Recebimentos e comprovantes', ['lp10', 'lp24', 'lp12', 'lp13']],
  ['Por tipo de negócio', ['lp25', 'lp26', 'lp27', 'lp28', 'lp29', 'lp30', 'lp31', 'lp32', 'lp33']],
]
const usados = GRUPOS.flatMap((g) => g[1])
if (usados.length !== paginas.length || new Set(usados).size !== paginas.length) throw new Error('página de guias não lista todas as páginas uma vez')
let hub = ler('documentacao.html')
hub = trocaRe(hub, /<title>.*?<\/title>/, '<title>Guias do financeiro do MEI | Granninha</title>')
hub = trocaRe(hub, /<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="Guias curtos e diretos sobre o financeiro do MEI: lucro, limite de faturamento, DAS, contas, cartão, comprovantes e controle por tipo de negócio." />')
hub = trocaRe(hub, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${BASE}/mei/" />`)
hub = trocaRe(hub, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${BASE}/mei/" />`)
hub = trocaRe(hub, /<meta property="og:title" content="[^"]*" \/>/, '<meta property="og:title" content="Guias do financeiro do MEI" />')
hub = trocaRe(hub, /<meta property="og:description" content="[^"]*" \/>/, '<meta property="og:description" content="Guias curtos e diretos sobre o financeiro do MEI." />')
hub = hub.replace(/<script type="application\/ld\+json">.*?<\/script>\n/gs, '')
hub = troca(hub, '<script src="/origem.js" data-lp="documentacao"></script>', '<script src="/origem.js" data-lp="guias"></script>')
hub = troca(hub, '</head>',
  ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: `${BASE}/` },
    { '@type': 'ListItem', position: 2, name: 'Guias para MEI', item: `${BASE}/mei/` }] }) +
  ld({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Guias do financeiro do MEI', itemListElement: paginas.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/mei/${p.slug}`, name: p.titulo })) }) +
  '</head>')
hub = troca(hub, '<div class="migalha"><a href="/">Início</a> / Como funciona</div>', '<div class="migalha"><a href="/">Início</a> / Guias para MEI</div>')
hub = troca(hub, '<h1>Como funciona a Granninha</h1>', '<h1>Guias do financeiro do MEI</h1>')
hub = trocaRe(hub, /(<h1>Guias do financeiro do MEI<\/h1>\n\s*<p>).*?(<\/p>)/s, '$1Respostas diretas para as dúvidas de dinheiro de quem é MEI: lucro, limite, DAS, contas, comprovantes e o controle de cada tipo de negócio.$2')
const porChave = Object.fromEntries(paginas.map((p) => [p.chave, p]))
const corpo = `<div class="wrap doc">
${GRUPOS.map(([nome, chaves], i) => `    <section class="secao">
      <div class="secao-cab"><img src="/img/${['ideia', 'calendario', 'checklist', 'apresentando'][i]}.png" alt="" /><div><small>${i + 1}</small><h2>${esc(nome)}</h2></div></div>
${chaves.map((k) => `      <h3><a href="/mei/${porChave[k].slug}" style="color:inherit">${esc(porChave[k].titulo)}</a></h3>\n      <p>${esc(porChave[k].desc)}</p>`).join('\n')}
    </section>`).join('\n\n')}
  </div>
</main>`
hub = trocaRe(hub, /<div class="wrap doc">.*?<\/main>/s, corpo)
writeFileSync(join(raiz, 'mei', 'index.html'), hub)

// ---------- 4. Redirecionamentos /lpN -> /mei/slug (UTM e demais parâmetros vão junto) ----------
writeFileSync(join(raiz, 'lps-redirects.inc'),
  '# Gerado por scripts/gerar-lps.mjs. Os anúncios podem continuar usando /lpN.\n' +
  paginas.map((p) => `location = /${p.chave} { return 301 /mei/${p.slug}$is_args$args; }`).join('\n') + '\n')

// ---------- 5. Sitemap e llms.txt ----------
const urls = [['/', '1.0'], ['/documentacao', '0.8'], ['/faq', '0.8'], ['/mei/', '0.8'], ...paginas.map((p) => [`/mei/${p.slug}`, '0.7'])]
writeFileSync(join(raiz, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, pr]) => `  <url><loc>${BASE}${u}</loc><lastmod>${HOJE}</lastmod><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`)
let llms = ler('llms.txt')
llms = llms.split('\n## Guias para MEI')[0].trimEnd() + '\n\n## Guias para MEI\n\n' +
  paginas.map((p) => `- [${p.titulo}](${BASE}/mei/${p.slug}): ${p.desc}`).join('\n') + '\n'
writeFileSync(join(raiz, 'llms.txt'), llms)

console.log(`${paginas.length} páginas em /mei, página de guias, redirecionamentos, sitemap e llms.txt gerados`)
