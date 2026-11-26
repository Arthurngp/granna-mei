/**
 * Auditoria de segurança de 2026-11-26: número de fora do Brasil não cai na conta de um cliente brasileiro.
 *   npx tsx test/seguranca-auditoria.ts
 */
import assert from 'node:assert/strict'
import { caso, fim } from './_falsos.ts'

const { chaveDoNumero } = await import('../src/banco.ts')

await caso('remetente do WhatsApp de fora do Brasil (+51 Peru) não tem chave: não vira o cliente do DDD 51', async () => {
  assert.equal(chaveDoNumero('51987654321@s.whatsapp.net'), null)
  assert.equal(chaveDoNumero('5491123456789@s.whatsapp.net'), null, 'Argentina')
  assert.equal(chaveDoNumero('5581987654321@s.whatsapp.net'), '8187654321', 'brasileiro continua')
  assert.equal(chaveDoNumero('558187654321@s.whatsapp.net'), '8187654321', 'sem o nono dígito continua')
})

await caso('número digitado no painel, sem o 55, continua valendo', async () => {
  assert.equal(chaveDoNumero('(51) 98765-4321'), '5187654321')
  assert.equal(chaveDoNumero('51987654321'), '5187654321')
})

fim()
