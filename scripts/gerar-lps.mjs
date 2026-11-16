// Gera as LPs de anúncio (site/lpN.html) a partir da home (site/index.html) e da copy em scripts/lps-dados.mjs.
// Uso: node scripts/gerar-lps.mjs
// Cada troca precisa achar o trecho exato da home. Se a home mudar e um trecho sumir, o script para com erro
// em vez de gerar página pela metade.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LPS } from './lps-dados.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'site')
const BASE = 'https://grannamei.amplasoft.me'
const home = readFileSync(join(raiz, 'index.html'), 'utf8')

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function troca(s, de, para, vezes = 1) {
  const n = s.split(de).length - 1
  if (n !== vezes) throw new Error(`trecho achado ${n}x (esperado ${vezes}): ${de.slice(0, 90)}`)
  return s.split(de).join(para)
}

const FITA = ['paguei 89 de luz', 'aluguel 900 todo dia 10', 'comprei 1.200 de material em 4x', 'a Bia me deve 150 pra sexta', 'quanto gastei esse mês?', 'paguei a fatura do cartão']

for (const lp of LPS) {
  let s = home
  const desc = `${lp.sub} Comece grátis, sem cartão.`
  // cabeçalho: título, descrição, compartilhamento, fora do Google, sem dados estruturados da home
  s = troca(s, '<title>Granna Mei: seu financeiro no WhatsApp</title>', `<title>Granna Mei: ${esc(lp.titulo)}</title>`)
  s = s.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(desc)}" />`)
  s = troca(s, '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />', '<meta name="robots" content="noindex, follow" />')
  s = troca(s, `<link rel="canonical" href="${BASE}/" />\n`, '')
  s = troca(s, `<meta property="og:url" content="${BASE}/" />`, `<meta property="og:url" content="${BASE}/${lp.slug}" />`)
  s = s.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(lp.titulo)}" />`)
  s = s.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(desc)}" />`)
  s = s.replace(/<script type="application\/ld\+json">.*?<\/script>\n/gs, '')
  s = troca(s, '<script src="/origem.js" data-lp="home"></script>', `<script src="/origem.js" data-lp="${lp.slug}"></script>`)
  // herói
  s = troca(s, '>Para MEI · o dinheiro do negócio em dia</p>', '>Para MEI · teste grátis</p>')
  s = troca(s, 'Seu financeiro <span style="color:#8FE9B8;white-space:nowrap">no WhatsApp.</span></h1>', `${esc(lp.h1[0])} <span style="color:#8FE9B8">${esc(lp.h1[1])}</span></h1>`)
  s = troca(s, 'font-size:clamp(52px,7.4vw,104px);line-height:.92', 'font-size:clamp(40px,5.4vw,78px);line-height:.96')
  s = troca(s, '>Você manda uma mensagem e a Granninha anota. Entradas, gastos, contas a pagar e o limite do MEI, sem planilha e sem aplicativo novo.</p>', `>${esc(lp.sub)}</p>`)
  // conversa no celular
  s = troca(s, 'max-width:84%">Recebi 150 da Juliana no pix</div>', `max-width:84%">${esc(lp.chat[0])}</div>`)
  s = troca(s, 'white-space:pre-line">Anotado: entrada de R$ 150,00\nServiços · Conta do banco · hoje\n\nErrou? Responda DESFAZER.</div>', `white-space:pre-line">${esc(lp.chat[1])}</div>`)
  s = troca(s, 'max-width:84%">Quanto sobrou esse mês?</div>', `max-width:84%">${esc(lp.chat[2])}</div>`)
  s = troca(s, 'max-width:88%">Entrou R$ 4.280,00 e saiu R$ 1.930,00. Sobrou R$ 2.350,00. Está indo bem!</div>', `max-width:88%;white-space:pre-line">${esc(lp.chat[3])}</div>`)
  // faixa de exemplos (cada frase aparece 2x: a segunda é a cópia do letreiro)
  // em duas etapas, para uma frase nova igual a uma antiga não ser trocada de novo
  FITA.forEach((f, i) => { s = troca(s, `“${f}”`, `“@@FITA${i}@@”`, 2) })
  FITA.forEach((_, i) => { s = troca(s, `@@FITA${i}@@`, esc(lp.fita[i]), 2) })
  // bloco da conta do mês
  s = troca(s, '>Exemplo de resposta da Granninha</p>', `>${esc(lp.contaKicker ?? 'Você pergunta “quanto sobrou?” e a Granninha responde')}</p>`)
  s = troca(s, 'Pergunte “quanto sobrou?” e receba o mês inteiro numa linha.</h2>', `${esc(lp.contaH2)}</h2>`)
  // como funciona
  s = troca(s, '>Simples como mandar mensagem</h2>', `>${esc(lp.comoH2)}</h2>`)
  s = troca(s, '<h3 style="font-size:22px">Mande do seu jeito</h3>\n          <p style="color:#4E557A;margin-top:8px">Por texto, áudio, foto do comprovante ou PDF. A Granninha entende e anota na hora.</p>',
    `<h3 style="font-size:22px">${esc(lp.passo2[0])}</h3>\n          <p style="color:#4E557A;margin-top:8px">${esc(lp.passo2[1])}</p>`)
  // pergunta própria da dor, primeira da lista
  s = troca(s, '<details><summary>Preciso instalar algum aplicativo?</summary>', `<details><summary>${esc(lp.faq[0])}</summary><p>${esc(lp.faq[1])}</p></details>\n        <details><summary>Preciso instalar algum aplicativo?</summary>`)
  // chamada final
  s = troca(s, 'Comece hoje e veja quanto sobra no fim do mês.</h2>', `${esc(lp.final)}</h2>`)
  writeFileSync(join(raiz, `${lp.slug}.html`), s)
  console.log(lp.slug, lp.dor)
}
console.log(`${LPS.length} LPs geradas`)
