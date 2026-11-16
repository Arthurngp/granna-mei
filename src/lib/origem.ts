/** Origem gravada pelo site (site/origem.js) no mesmo domínio: de qual LP e de qual anúncio a pessoa veio. */
export interface Chegada {
  lp: string
  em: string
  ref?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  fbclid?: string
  gclid?: string
}

export function lerOrigem(): { primeira?: Chegada; ultima?: Chegada } | null {
  try {
    const a = JSON.parse(localStorage.getItem('gm_origem') || 'null')
    return a && typeof a === 'object' ? a : null
  } catch {
    return null
  }
}
