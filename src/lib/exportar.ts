import type { Estado, Lancamento } from './tipos'

export function baixar(nome: string, conteudo: string, mime: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

const TIPO = { entrada: 'Entrada', saida: 'Saída', transferencia: 'Transferência', compra_cartao: 'Compra no cartão' }
const ORIGEM = { texto: 'WhatsApp (texto)', audio: 'WhatsApp (áudio)', foto: 'WhatsApp (foto)', pdf: 'WhatsApp (PDF)', painel: 'Painel' }

/** Planilha que abre direto no Excel brasileiro: ponto e vírgula, vírgula decimal e marca de UTF-8. */
export function csvLancamentos(s: Estado, lancs: Lancamento[]) {
  const cel = (v: string) => `"${v.replace(/"/g, '""')}"`
  const nomeCarteira = (id?: string) => s.carteiras.find((c) => c.id === id)?.nome ?? ''
  const linhas = [['Data', 'Hora', 'Tipo', 'Descrição', 'Categoria', 'Carteira', 'Destino', 'Valor', 'Gasto pessoal', 'Fatura do cartão', 'Como chegou', 'Comprovante'].join(';')]
  for (const l of [...lancs].sort((a, b) => (a.data + a.hora < b.data + b.hora ? -1 : 1))) {
    linhas.push(
      [
        l.data.split('-').reverse().join('/'),
        l.hora,
        TIPO[l.tipo],
        cel(l.descricao),
        cel(s.categorias.find((c) => c.id === l.categoriaId)?.nome ?? ''),
        cel(nomeCarteira(l.carteiraId)),
        cel(nomeCarteira(l.carteiraDestinoId)),
        (l.tipo === 'saida' || l.tipo === 'compra_cartao' ? -l.valor : l.valor).toFixed(2).replace('.', ','),
        l.pessoal ? 'Sim' : 'Não',
        l.fatura ? l.fatura.split('-').reverse().join('/') : '',
        ORIGEM[l.origem],
        l.anexo ? 'Sim' : 'Não',
      ].join(';'),
    )
  }
  return '﻿' + linhas.join('\r\n')
}
