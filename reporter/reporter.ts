// Reporter de consumo: lee el consumo ACUMULADO de una eSIM y lo reporta al contrato medidor.
// El contrato cobra solo la diferencia con lo ya cobrado, así que repetir un reporte no cobra dos veces.
//
// Es la versión reducida del servicio que usamos en el piloto con una eSIM real. Aquí la fuente de consumo
// es cualquier endpoint HTTP que devuelva JSON con los bytes acumulados; las credenciales van por variables
// de entorno. Usa las cuentas de demostración de testnet (web/src/demo-config.ts).
//
//   npm run demo     crea una billetera de prueba, simula una eSIM que consume datos y la cobra en testnet
//   npm start        modo real:  USER_ADDRESS=G...  USAGE_URL=https://...  [USAGE_TOKEN=...]
//                                [USAGE_FIELD=usedBytes]  [POLL_SECONDS=60]
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createFlow, txUrl } from '../web/src/flow'

const sdk = createRequire(import.meta.url)('@stellar/stellar-sdk')
const flow = createFlow(sdk)
const MB = 1024 * 1024
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Lee los bytes acumulados que informa el proveedor de la eSIM. */
async function leerConsumo(url: string, campo: string, token?: string): Promise<number> {
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`la fuente de consumo respondió ${res.status}`)
  const bytes = Number((await res.json())[campo])
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error(`el campo "${campo}" no trae un número de bytes`)
  return bytes
}

/** Consulta la fuente cada cierto tiempo y cobra cuando el acumulado avanzó. */
async function reportar(o: { user: string; url: string; campo: string; token?: string; cadaSeg: number; vueltas?: number }) {
  let cobradoMb = 0
  for (let i = 0; o.vueltas === undefined || i < o.vueltas; i++) {
    try {
      const acumuladoMb = Math.floor((await leerConsumo(o.url, o.campo, o.token) / MB) * 100) / 100
      if (acumuladoMb > cobradoMb) {
        const tx = await flow.charge(o.user, acumuladoMb, acumuladoMb - cobradoMb)
        console.log(`cobro de ${(acumuladoMb - cobradoMb).toFixed(2)} MB (acumulado ${acumuladoMb} MB)  ${txUrl(tx.hash)}`)
        cobradoMb = acumuladoMb
      } else console.log(`sin consumo nuevo (acumulado ${acumuladoMb} MB)`)
    } catch (e) {
      // Si falla la lectura o el cobro (sin saldo, tope superado), se reintenta en la próxima vuelta:
      // como el reporte es acumulado, no se pierde ni se duplica nada.
      console.error('no se pudo reportar:', (e as Error).message)
    }
    await sleep(o.cadaSeg * 1000)
  }
  return cobradoMb
}

if (process.argv.includes('--demo')) {
  // Billetera nueva con 10 USDC de prueba y un tope de gasto de 5 USDC.
  const { kp } = await flow.createWallet()
  await flow.topUp(kp.publicKey(), 10)
  await flow.approve(kp, 5)
  console.log('billetera de prueba', kp.publicKey(), '· saldo', await flow.balance(kp.publicKey()), 'USDC')
  // Fuente simulada: una eSIM que consume 20 MB cada vez que se la consulta, hasta 60 MB.
  let usados = 0
  const fuente = createServer((_, res) => { usados = Math.min(usados + 20 * MB, 60 * MB); res.end(JSON.stringify({ usedBytes: usados })) })
  await new Promise<void>((r) => fuente.listen(0, '127.0.0.1', r))
  const puerto = (fuente.address() as { port: number }).port
  const total = await reportar({ user: kp.publicKey(), url: `http://127.0.0.1:${puerto}/`, campo: 'usedBytes', cadaSeg: 6, vueltas: 4 })
  fuente.close()
  console.log(`cobrado en total: ${total} MB · saldo final`, await flow.balance(kp.publicKey()), 'USDC')
} else {
  const { USER_ADDRESS, USAGE_URL, USAGE_TOKEN, USAGE_FIELD = 'usedBytes', POLL_SECONDS = '60' } = process.env
  if (!USER_ADDRESS || !USAGE_URL) { console.error('Faltan USER_ADDRESS y USAGE_URL. Para una prueba sin configurar nada: npm run demo'); process.exit(1) }
  await reportar({ user: USER_ADDRESS, url: USAGE_URL, campo: USAGE_FIELD, token: USAGE_TOKEN, cadaSeg: Number(POLL_SECONDS) })
}
