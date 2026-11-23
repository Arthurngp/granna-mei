import { Check } from 'lucide-react'
import { useMemo } from 'react'
import { Barras, Medidor } from '../components/Graficos'
import { FaixaAssinatura, Topo } from '../components/Shell'
import { Mascote, useAviso } from '../components/ui'
import { faturamentoAno } from '../lib/calc'
import { LIMITE_MEI } from '../lib/config'
import { brl, brlCurto, capitaliza, diaCurto, hoje, mesDe, nomeMes, parse, pct, prazo, tipoDocumento } from '../lib/format'
import { useApp } from '../lib/store'

const MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export default function MeuMei() {
  const { s, pagarConta, reabrirConta } = useApp()
  const avisar = useAviso()
  const h = hoje()
  const ano = h.slice(0, 4)
  const fat = useMemo(() => faturamentoAno(s, ano), [s, ano])
  const frac = fat.total / LIMITE_MEI
  const resta = Math.max(0, LIMITE_MEI - fat.total)
  const mesN = Number(h.slice(5, 7))
  const mesesRestantes = 12 - mesN + 1

  const projecao = useMemo(() => {
    const inicio = parse(`${ano}-01-01`).getTime()
    const dias = Math.max(1, Math.round((parse(h).getTime() - inicio) / 86400000) + 1)
    return (fat.total / dias) * 365
  }, [fat.total, h, ano])

  const das = useMemo(() => s.contas.filter((c) => c.das && c.vencimento.startsWith(ano)).sort((a, b) => (a.vencimento < b.vencimento ? 1 : -1)), [s.contas, ano])
  const dasVisiveis = das.filter((c) => mesDe(c.vencimento) <= mesDe(h))
  const proximo = [...das].reverse().find((c) => c.status === 'aberta')

  const situacao =
    frac >= 1
      ? { pose: 'sino' as const, titulo: 'Você passou do limite do MEI', texto: 'Fale com seu contador o quanto antes: pode ser hora de mudar de categoria e isso tem prazo.' }
      : frac >= 0.9
        ? { pose: 'sino' as const, titulo: 'Muito perto do limite', texto: `Faltam só ${brl(resta)} para o teto do ano. Converse com seu contador antes de passar.` }
        : frac >= 0.7
          ? { pose: 'mei' as const, titulo: 'Atenção ao limite', texto: `Você ainda pode faturar ${brl(resta)} em ${ano}, cerca de ${brl(resta / mesesRestantes)} por mês até dezembro.` }
          : { pose: 'heroi' as const, titulo: 'Dentro do limite, com folga', texto: `Você ainda pode faturar ${brl(resta)} em ${ano}.` }

  return (
    <div className="pagina">
      <Topo titulo="Meu MEI" sub={s.usuario.cnpj ? `${tipoDocumento(s.usuario.cnpj)} ${s.usuario.cnpj}` : s.usuario.negocio || undefined} />
      <FaixaAssinatura />

      <div className="grade">
        <section className="card g-5 estica">
          <div className="card-cab">
            <h2>Limite de faturamento de {ano}</h2>
          </div>
          <Medidor frac={frac} texto={pct(frac)} sub={`de ${brlCurto(LIMITE_MEI)}`} />
          <div className="duo" style={{ marginTop: 14 }}>
            <div>
              <div className="suave pq">Já faturou</div>
              <div className="num" style={{ fontWeight: 740, fontSize: 17 }}>{brl(fat.total)}</div>
            </div>
            <div>
              <div className="suave pq">No ritmo atual, fecha o ano em</div>
              <div className={`num ${projecao > LIMITE_MEI ? 'cor-out' : ''}`} style={{ fontWeight: 740, fontSize: 17 }}>{brl(projecao)}</div>
            </div>
          </div>
        </section>

        <section className="card g-7 estica" style={{ display: 'grid', alignContent: 'center' }}>
          <div className="recado">
            <Mascote pose={situacao.pose} tam={104} anim="flutua" />
            <div className="balao">
              <b>{situacao.titulo}</b>
              <br />
              {situacao.texto}
            </div>
          </div>
        </section>

        <section className="card g-7">
          <div className="card-cab">
            <h2>Faturamento mês a mês</h2>
          </div>
          <Barras labels={MESES_C} series={[{ nome: 'Faturou', cor: '#454C83', valores: fat.porMes }]} teto={{ valor: LIMITE_MEI / 12, rotulo: `Média do limite: ${brlCurto(LIMITE_MEI / 12)}` }} />
        </section>

        <section className="card g-5">
          <div className="card-cab">
            <h2>Números para a declaração anual</h2>
          </div>
          <div className="fatos">
            <div>
              <span>Receita de serviços</span>
              <span className="num">{brl(fat.servico)}</span>
            </div>
            <div>
              <span>Receita de comércio</span>
              <span className="num">{brl(fat.comercio)}</span>
            </div>
            <div>
              <span>Total de {ano}</span>
              <span className="num">{brl(fat.total)}</span>
            </div>
          </div>
          <p className="suave pq" style={{ marginTop: 10 }}>
            São os valores que a declaração anual do MEI (DASN) pede. O prazo de entrega é 31 de maio do ano seguinte.
          </p>
        </section>

        <section className="card" style={{ paddingBottom: 6 }}>
          <div className="card-cab" style={{ marginBottom: 2 }}>
            <h2>DAS: o imposto do mês</h2>
            {proximo && <span className={`pq ${proximo.vencimento < h ? 'atraso' : 'suave'}`}>Próximo {prazo(proximo.vencimento)}</span>}
          </div>
          {dasVisiveis.length === 0 ? (
            <p className="suave" style={{ padding: '10px 0 14px' }}>
              Ainda não tem DAS registrado. Me diga no WhatsApp: "meu DAS é 86 todo dia 20".
            </p>
          ) : (
            <div className="lista">
              {dasVisiveis.slice(0, 6).map((c) => (
                <div className="linha" key={c.id}>
                  <button
                    type="button"
                    className={`marca ${c.status === 'paga' ? 'ok' : ''}`}
                    aria-label={c.status === 'paga' ? `Desmarcar DAS de ${nomeMes(mesDe(c.vencimento), false)}` : `Marcar DAS de ${nomeMes(mesDe(c.vencimento), false)} como pago`}
                    onClick={() => {
                      if (c.status === 'paga') {
                        reabrirConta(c.id)
                        avisar('DAS voltou para em aberto')
                      } else {
                        pagarConta(c.id)
                        avisar('DAS marcado como pago', { rotulo: 'Desfazer', fn: () => reabrirConta(c.id) })
                      }
                    }}
                  >
                    <Check size={16} strokeWidth={3} />
                  </button>
                  <div className="meio">
                    <div className="tit">DAS de {capitaliza(nomeMes(mesDe(c.vencimento), false))}</div>
                    <div className="det">
                      <span className={c.status === 'aberta' && c.vencimento < h ? 'atraso' : ''}>{c.status === 'paga' ? `Pago em ${diaCurto(c.pagoEm ?? c.vencimento)}` : capitaliza(prazo(c.vencimento))}</span>
                    </div>
                  </div>
                  <div className="val num">{brl(c.valor)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
