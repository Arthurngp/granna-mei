/**
 * Saldo de cada carteira: saldo inicial mais tudo que entrou, saiu e foi transferido.
 * Compra no cartão e saída tiram da carteira; transferência (inclusive pagamento de fatura) tira da origem e põe no destino.
 *
 * ESTE ARQUIVO EXISTE IGUAL EM DOIS LUGARES: src/lib/saldo.ts (painel) e server/src/saldo.ts (Granninha).
 * É a ÚNICA conta de saldo do sistema: o painel e o WhatsApp respondem o mesmo número porque usam o mesmo código.
 * O teste server/test/saldo.ts falha se os dois divergirem.
 */

export interface CarteiraSaldo {
  id: string
  saldoInicial: number
}

export interface MovSaldo {
  tipo: string
  valor: number
  carteiraId: string
  carteiraDestinoId?: string
}

/** Arredonda para centavos: soma de decimais não pode vazar 0,0000001 para a resposta. */
export const centavosDe = (n: number) => Math.round(n * 100) / 100

export function saldosDas(carteiras: CarteiraSaldo[], movs: MovSaldo[]): Record<string, number> {
  const r: Record<string, number> = {}
  for (const c of carteiras) r[c.id] = c.saldoInicial
  for (const l of movs) {
    if (l.tipo === 'entrada') r[l.carteiraId] = (r[l.carteiraId] ?? 0) + l.valor
    else if (l.tipo === 'saida') r[l.carteiraId] = (r[l.carteiraId] ?? 0) - l.valor
    else {
      r[l.carteiraId] = (r[l.carteiraId] ?? 0) - l.valor
      if (l.carteiraDestinoId) r[l.carteiraDestinoId] = (r[l.carteiraDestinoId] ?? 0) + l.valor
    }
  }
  for (const k of Object.keys(r)) r[k] = centavosDe(r[k])
  return r
}
