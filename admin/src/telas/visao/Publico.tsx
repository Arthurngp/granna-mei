import { useState } from 'react'
import { RAMOS } from '../../../../src/lib/config'
import { custoReais, reais, type Consumo } from '../../custo'
import { Falha, NOME_SITUACAO } from '../comum'
import { BarraH, Cartao, Pagina, type HeadDef } from './layout'
import { Ausente, n, pct, useRpc } from './usar'

interface Seg extends Consumo {
  dim: 'ramo' | 'idade' | 'faturamento' | 'cidade'
  grupo: string
  pessoas: number
  confirmados: number
  ativos7: number
  msgs7: number
}
interface Pessoa {
  user_id: string
  nome: string
  negocio: string
  ramo: string
  ocupacao: string
  cidade: string
  uf: string
  faixa_idade: string | null
  faturamento_faixa: string
  criado_em: string
  msgs7: number
  situacao: string | null
}
interface Pub {
  cobertura: { total: number; completos: number }
  segmentos: Seg[]
  outros: { total: number; sem_ocupacao: number; ocupacoes: { ocupacao: string; n: number }[] }
  pessoas: Pessoa[]
}

const RAMO_NOME: Record<string, string> = { ...Object.fromEntries(RAMOS.map((r) => [r.id, r.nome])), sem_ramo: 'Sem ramo' }
const FAT_NOME: Record<string, string> = { ate_2: 'Até R$ 2 mil', '2_4': 'R$ 2 a 4 mil', '4_6750': 'R$ 4 a 6,75 mil', acima: 'Acima de R$ 6,75 mil' }
const ORDEM_IDADE = ['Até 24', '25 a 34', '35 a 44', '45 a 54', '55 ou mais']
const ORDEM_FAT = ['ate_2', '2_4', '4_6750', 'acima']
const COR_SIT: Record<string, string> = { trial: '#454c83', ativa: '#0e8250', cortesia: '#7a4fb5', teste_vencido: '#cc3340', bloqueada: '#8a90b0', atrasada: '#9a6408' }

type Dim = 'ramo' | 'idade' | 'faturamento'
const nomeGrupo = (dim: string, g: string) => (dim === 'ramo' ? (RAMO_NOME[g] ?? g) : dim === 'faturamento' ? (FAT_NOME[g] ?? g) : g)

export function Publico() {
  const { dados, erro, ausente } = useRpc<Pub>('admin_publico', {}, 120_000)
  const [dim, setDim] = useState<Dim>('ramo')
  const [fil, setFil] = useState<'todas' | 'ativas' | 'sem'>('todas')

  if (ausente) return <Pagina titulo="Público" heads={[]}><Ausente nome="admin_publico" /></Pagina>
  if (erro) return <Pagina titulo="Público" heads={[]}><Falha texto={erro} /></Pagina>

  const seg = (d: string) => (dados?.segmentos ?? []).filter((s) => s.dim === d)
  const ramos = seg('ramo')
  const idades = ORDEM_IDADE.map((g) => seg('idade').find((s) => s.grupo === g)).filter((s): s is Seg => !!s)
  const fats = ORDEM_FAT.map((g) => seg('faturamento').find((s) => s.grupo === g)).filter((s): s is Seg => !!s)
  const cidades = seg('cidade').slice(0, 8)
  const melhor = (lista: Seg[]) => {
    const ok = lista.filter((s) => s.pessoas >= 3)
    return ok.length ? ok.reduce((a, b) => (b.ativos7 / b.pessoas > a.ativos7 / a.pessoas ? b : a)) : null
  }
  const mRamo = melhor(ramos)
  const mIdade = melhor(idades)
  const cob = dados?.cobertura

  const heads: HeadDef[] | undefined = dados
    ? [
        { rotulo: 'Perfis completos', valor: n(cob?.completos ?? 0), nota: `de ${n(cob?.total ?? 0)} clientes (${pct(cob?.completos ?? 0, cob?.total ?? 0)})` },
        { rotulo: 'Ramo que mais usa', valor: mRamo ? nomeGrupo('ramo', mRamo.grupo) : '–', nota: mRamo ? `${pct(mRamo.ativos7, mRamo.pessoas)} usaram esta semana` : 'precisa de grupos com 3 pessoas', texto: true },
        { rotulo: 'Idade que mais usa', valor: mIdade ? mIdade.grupo : '–', nota: mIdade ? `${n(mIdade.ativos7)} de ${n(mIdade.pessoas)} usaram esta semana` : 'ainda sem idades suficientes', texto: true },
        { rotulo: 'Cidade que mais cadastra', valor: cidades[0]?.grupo ?? '–', nota: cidades[0] ? `${n(cidades[0].pessoas)} ${cidades[0].pessoas === 1 ? 'pessoa informou' : 'pessoas informaram'} essa cidade` : 'ainda sem cidades', texto: true },
      ]
    : undefined

  const linhasSeg = (dim === 'ramo' ? ramos : dim === 'idade' ? idades : fats).slice(0, 8)
  const melhorSeg = melhor(linhasSeg)
  const pessoas = (dados?.pessoas ?? []).filter((p) => (fil === 'ativas' ? p.msgs7 > 0 : fil === 'sem' ? !p.faixa_idade && !p.cidade && !p.faturamento_faixa : true))
  const nAtivas = (dados?.pessoas ?? []).filter((p) => p.msgs7 > 0).length
  const nSem = (dados?.pessoas ?? []).filter((p) => !p.faixa_idade && !p.cidade && !p.faturamento_faixa).length
  const incompleto = cob && cob.total > 0 && cob.completos < cob.total

  return (
    <Pagina titulo="Público" subtitulo="Quem são os clientes e quais perfis mais usam a Granninha" heads={heads}>
      {cob && incompleto && (
        <Cartao g={12}>
          <div className="cobertura">
            <p>
              <b>{n(cob.completos)} de {n(cob.total)}</b> clientes contaram idade, cidade e faturamento. O ramo vem de todos. Cada gráfico conta quem preencheu aquele campo, mesmo sem o perfil completo: com amostra pequena, serve para ter ideias, não para decidir.
            </p>
            <div className="cobertura-b">
              <div className="hb-t"><i style={{ width: `${cob.total ? (cob.completos / cob.total) * 100 : 0}%`, background: '#0e8250' }} /></div>
              <small>{pct(cob.completos, cob.total)} com perfil completo · {n(cob.total - cob.completos)} faltam</small>
            </div>
          </div>
        </Cartao>
      )}

      <Cartao g={4} titulo="Ramo" nota={dados ? `${n(cob?.total ?? 0)} clientes` : undefined}>
        {dados ? (
          <>
            {ramos.map((s, i) => (
              <div key={s.grupo} className={i === 0 ? 'topo-1' : ''}><BarraH nome={nomeGrupo('ramo', s.grupo)} n={s.pessoas} max={ramos[0]?.pessoas ?? 1} /></div>
            ))}
            {dados.outros.total > 0 && (
              <div className="ocup">
                <h3>O que escreveram em “Outro ramo”</h3>
                {dados.outros.ocupacoes.map((o) => (
                  <div key={o.ocupacao} className="oc"><span>{o.ocupacao}</span><b>{o.n}</b></div>
                ))}
                {dados.outros.sem_ocupacao > 0 && <div className="oc vz"><span>Sem ocupação (cadastro antigo)</span><b>{dados.outros.sem_ocupacao}</b></div>}
                <p className="rodape-cartao" style={{ paddingTop: 8 }}>Quando uma ocupação se repetir, vale virar um ramo próprio.</p>
              </div>
            )}
          </>
        ) : (
          <span className="skel" style={{ height: 240 }} />
        )}
      </Cartao>

      <Cartao g={4} titulo="Idade" nota={dados ? `${n(idades.reduce((s, x) => s + x.pessoas, 0))} perfis` : undefined}>
        {dados ? (
          idades.length ? (
            <>
              {idades.map((s) => <BarraH key={s.grupo} nome={s.grupo} n={s.pessoas} max={Math.max(...idades.map((x) => x.pessoas))} />)}
              <p className="rodape-cartao">A data de nascimento fica guardada, mas o admin mostra só a faixa.</p>
            </>
          ) : (
            <p className="texto-ajuda" style={{ margin: 0 }}>Ninguém informou a data de nascimento ainda. Isso começa quando o cadastro passar a perguntar.</p>
          )
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={4} titulo="Faturamento do negócio por mês" nota={dados ? `${n(fats.reduce((s, x) => s + x.pessoas, 0))} perfis` : undefined}>
        {dados ? (
          fats.length ? (
            <>
              {fats.map((s) => <BarraH key={s.grupo} nome={nomeGrupo('faturamento', s.grupo)} n={s.pessoas} max={Math.max(...fats.map((x) => x.pessoas))} />)}
              <p className="rodape-cartao">R$ 6.750 por mês é o teto do MEI (R$ 81 mil por ano). Quem passa dele precisa mudar de enquadramento.</p>
            </>
          ) : (
            <p className="texto-ajuda" style={{ margin: 0 }}>Ninguém informou o faturamento ainda.</p>
          )
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao g={6} titulo="Cidades" nota={dados ? `${n(cidades.reduce((s, x) => s + x.pessoas, 0))} perfis` : undefined}>
        {dados ? (
          cidades.length ? cidades.map((s, i) => <div key={s.grupo} className={i === 0 ? 'topo-1' : ''}><BarraH nome={s.grupo} n={s.pessoas} max={cidades[0].pessoas} /></div>) : <p className="texto-ajuda" style={{ margin: 0 }}>Ninguém informou a cidade ainda.</p>
        ) : (
          <span className="skel" style={{ height: 200 }} />
        )}
      </Cartao>

      <Cartao
        g={6}
        titulo="Quem mais usa"
        lado={
          <div className="vseg" role="group" aria-label="Agrupar por">
            {([['ramo', 'Ramo'], ['idade', 'Idade'], ['faturamento', 'Faturamento']] as const).map(([v, r]) => (
              <button key={v} type="button" className={dim === v ? 'on' : ''} aria-pressed={dim === v} onClick={() => setDim(v)}>
                {r}
              </button>
            ))}
          </div>
        }
      >
        {dados ? (
          linhasSeg.length ? (
            <div className="rolagem">
              <div className="sg cab"><span>Grupo</span><span className="n">Pessoas</span><span>Usaram esta semana</span><span className="m">Msgs por semana</span><span className="c">IA por mês</span></div>
              {linhasSeg.map((s) => {
                const p = s.pessoas ? Math.round((s.ativos7 / s.pessoas) * 100) : 0
                return (
                  <div key={s.grupo} className={`sg ${melhorSeg && melhorSeg.grupo === s.grupo ? 'best' : ''}`}>
                    <b>{nomeGrupo(dim, s.grupo)}</b>
                    <span className="n">{n(s.pessoas)}</span>
                    <div className="b"><div className="t"><i style={{ width: `${p}%` }} /></div><span>{p}%</span></div>
                    <span className="m">{s.ativos7 ? n(Math.round(s.msgs7 / s.ativos7)) : '–'}</span>
                    <span className="c">{s.pessoas ? reais(custoReais(s) / s.pessoas) : '–'}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="texto-ajuda" style={{ margin: 0 }}>Ainda sem dados para este agrupamento.</p>
          )
        ) : (
          <span className="skel" style={{ height: 220 }} />
        )}
        <p className="rodape-cartao">Verde é o grupo que mais usa (só entre grupos com 3 pessoas ou mais). Mensagens por semana é a média de quem usou. Use para escolher quem mirar nos anúncios.</p>
      </Cartao>

      <Cartao
        g={12}
        titulo="Pessoas"
        lado={
          <div className="filtros" role="group" aria-label="Filtrar">
            <button type="button" className={fil === 'todas' ? 'on' : ''} onClick={() => setFil('todas')}>Todas<b>{n(dados?.pessoas.length ?? 0)}</b></button>
            <button type="button" className={fil === 'ativas' ? 'on' : ''} onClick={() => setFil('ativas')}>Usaram esta semana<b>{n(nAtivas)}</b></button>
            <button type="button" className={fil === 'sem' ? 'on' : ''} onClick={() => setFil('sem')}>Sem perfil<b>{n(nSem)}</b></button>
          </div>
        }
      >
        {dados ? (
          <>
            <div className="pessoa-cab"><span>Cliente</span><span>Ramo</span><span>Cidade</span><span>Idade</span><span>Faturamento</span><span>Cadastro</span><span>Msgs 7 dias</span><span>Situação</span></div>
            {pessoas.map((p) => (
              <article key={p.user_id} className="pessoa">
                <div><b>{p.nome || 'Sem nome'}</b><span className="s">{p.negocio || 'Sem negócio'}</span></div>
                <span className="sit-t" style={{ color: COR_SIT[p.situacao ?? ''] ?? '#5b6288' }}>{NOME_SITUACAO[p.situacao ?? ''] ?? p.situacao ?? '–'}</span>
                <div className="meta">
                  <span>{p.ramo === 'outro' && p.ocupacao ? `Outro: ${p.ocupacao}` : (RAMO_NOME[p.ramo] ?? (p.ramo || '–'))}</span>
                  <span className={p.cidade ? '' : 'vz'}>{p.cidade ? `${p.cidade}${p.uf ? `, ${p.uf}` : ''}` : 'não informou'}</span>
                  <span className={p.faixa_idade ? '' : 'vz'}>{p.faixa_idade ?? 'não informou'}</span>
                  <span className={p.faturamento_faixa ? '' : 'vz'}>{p.faturamento_faixa ? (FAT_NOME[p.faturamento_faixa] ?? 'prefere não dizer') : 'não informou'}</span>
                  <span>{new Date(p.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}</span>
                  <span>{n(p.msgs7)} msg</span>
                </div>
              </article>
            ))}
            {pessoas.length === 0 && <p className="texto-ajuda">Ninguém neste filtro.</p>}
            <p className="texto-ajuda">Mostra os 200 cadastros mais recentes. Idade, cidade e faturamento são opcionais e só o administrador vê. A exportação em CSV fica para depois, junto com o registro na auditoria.</p>
          </>
        ) : (
          <span className="skel" style={{ height: 260 }} />
        )}
      </Cartao>
    </Pagina>
  )
}
