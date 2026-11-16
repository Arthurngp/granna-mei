/** Foto de perfil: recorta o centro em quadrado e reduz para 400 px em JPEG, antes de subir (fica em torno de 40 KB). */
export async function prepararFoto(arquivo: File, lado = 400): Promise<Blob> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha uma imagem (foto da galeria ou da câmera).')
  let fonte: CanvasImageSource
  let w: number
  let h: number
  try {
    // createImageBitmap já respeita a rotação da foto do celular (EXIF).
    const bmp = await createImageBitmap(arquivo)
    ;[fonte, w, h] = [bmp, bmp.width, bmp.height]
  } catch {
    const url = URL.createObjectURL(arquivo)
    try {
      const img = await new Promise<HTMLImageElement>((ok, falha) => {
        const i = new Image()
        i.onload = () => ok(i)
        i.onerror = () => falha(new Error('Não consegui abrir essa imagem. Tente outra foto.'))
        i.src = url
      })
      ;[fonte, w, h] = [img, img.naturalWidth, img.naturalHeight]
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const m = Math.min(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a foto.')
  ctx.drawImage(fonte, (w - m) / 2, (h - m) / 2, m, m, 0, 0, lado, lado)
  return new Promise((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui preparar a foto.'))), 'image/jpeg', 0.85))
}

export const blobParaDataUrl = (b: Blob) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as string)
    r.onerror = () => falha(r.error)
    r.readAsDataURL(b)
  })
