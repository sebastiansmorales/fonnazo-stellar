// Lógica de la demo sobre Stellar TESTNET. Recibe el SDK por parámetro para correr igual en el
// navegador (bundle global StellarSdk) y en Node (prueba de punta a punta, scripts/e2e.mjs).
import { DEMO } from './demo-config'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sdk = any

export const DECIMALS = 7
const UNIT = 10n ** BigInt(DECIMALS)
export const MB = 1_000_000 // el contrato cuenta 1 GB = 1.000.000.000 bytes

export const toUnits = (usdc: number) => BigInt(Math.round(usdc * Number(UNIT)))
export const fromUnits = (v: bigint) => Number(v) / Number(UNIT)
export const txUrl = (hash: string) => `${DEMO.explorer}/tx/${hash}`
export const accountUrl = (id: string) => `${DEMO.explorer}/account/${id}`
export const contractUrl = (id: string) => `${DEMO.explorer}/contract/${id}`

export type Tx = { hash: string; what: string }

export function createFlow(sdk: Sdk) {
  const { Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, Networks, Contract, nativeToScVal, scValToNative, rpc, Address } = sdk
  const server = new rpc.Server(DEMO.rpcUrl)
  const passphrase = Networks.TESTNET
  const usdc = new Asset(DEMO.tokenCode, DEMO.tokenIssuer)
  const merchant = Keypair.fromSecret(DEMO.merchantSecret)
  const topup = Keypair.fromSecret(DEMO.topupSecret)

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  /**
   * Arma, firma y envía; si la red pide reintentar, vuelve a armar con la secuencia nueva.
   * Las cuentas del comercio y de recargas son compartidas por todos los visitantes de la demo, y
   * Stellar acepta una transacción por cuenta a la vez: dos visitas simultáneas chocan
   * (TRY_AGAIN_LATER o secuencia vieja) y hay que reintentar.
   */
  async function submit(signer: any, op: any, what: string, prepare: boolean): Promise<Tx> {
    let last = ''
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await sleep(1500 + Math.random() * 2500)
      try {
        const acc = await server.getAccount(signer.publicKey())
        let tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: passphrase }).addOperation(op).setTimeout(60).build()
        if (prepare) tx = await server.prepareTransaction(tx)
        tx.sign(signer)
        const sent = await server.sendTransaction(tx)
        if (sent.status === 'TRY_AGAIN_LATER' || sent.status === 'ERROR') { last = sent.status; continue }
        if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') { last = sent.status; continue }
        const done = await server.pollTransaction(sent.hash, { attempts: 12, sleepStrategy: () => 1000 })
        if (done.status === 'SUCCESS') return { hash: sent.hash, what }
        last = done.status
      } catch (e: any) {
        last = e?.message ?? String(e)
        // Un error del contrato (sin saldo, tope superado) no se arregla reintentando.
        if (/Error\(Contract|HostError/.test(last)) break
      }
    }
    throw new Error(`${what}: la red no aceptó la transacción (${last.slice(0, 120)})`)
  }

  const classic = (signer: any, op: any, what: string) => submit(signer, op, what, false)
  const soroban = (signer: any, op: any, what: string) => submit(signer, op, what, true)

  /** Lectura sin costo: simula la llamada y devuelve el valor. */
  async function read(contractId: string, method: string, args: any[]) {
    const acc = await server.getAccount(merchant.publicKey())
    const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(new Contract(contractId).call(method, ...args)).setTimeout(30).build()
    const sim = await server.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
    return scValToNative(sim.result.retval)
  }

  const addr = (id: string) => nativeToScVal(id, { type: 'address' })

  return {
    merchantId: merchant.publicKey(),

    /** 1. Billetera nueva del viajero: se fondea con XLM de prueba y acepta el USDC de la demo. */
    async createWallet(secret?: string) {
      const kp = secret ? Keypair.fromSecret(secret) : Keypair.random()
      const txs: Tx[] = []
      let exists = true
      try { await server.getAccount(kp.publicKey()) } catch { exists = false }
      if (!exists) {
        const r = await fetch(`${DEMO.friendbot}/?addr=${encodeURIComponent(kp.publicKey())}`)
        if (!r.ok) throw new Error(`friendbot respondió ${r.status}`)
        const body = await r.json().catch(() => ({}))
        if (body.hash) txs.push({ hash: body.hash, what: 'Cuenta creada en testnet' })
        txs.push(await classic(kp, Operation.changeTrust({ asset: usdc }), 'La billetera acepta USDC'))
      }
      return { kp, txs }
    },

    /** 2. Recarga: el pago en Bs por QR se simula; los USDC llegan de verdad a la billetera. */
    topUp(userId: string, amountUsdc: number) {
      return classic(topup, Operation.payment({ destination: userId, asset: usdc, amount: amountUsdc.toFixed(2) }), `Recarga de ${amountUsdc.toFixed(2)} USDC`)
    },

    /** 3. Tope de gasto: el viajero autoriza al contrato medidor a cobrarle hasta este monto. */
    async approve(kp: any, capUsdc: number) {
      const latest = await server.getLatestLedger()
      const op = new Contract(DEMO.tokenContractId).call(
        'approve', addr(kp.publicKey()), addr(DEMO.meterContractId),
        nativeToScVal(toUnits(capUsdc), { type: 'i128' }), nativeToScVal(latest.sequence + 17_280 * 7, { type: 'u32' }),
      )
      return soroban(kp, op, `Tope de gasto: ${capUsdc} USDC`)
    },

    /** 4. Cobro: el comercio reporta el consumo acumulado; el contrato cobra solo la diferencia. */
    charge(userId: string, cumulativeMb: number, deltaMb: number) {
      const op = new Contract(DEMO.meterContractId).call(
        'charge', addr(userId), nativeToScVal(DEMO.country, { type: 'symbol' }), nativeToScVal(BigInt(cumulativeMb * MB), { type: 'u64' }),
      )
      return soroban(merchant, op, deltaMb > 0 ? `Cobro de ${deltaMb} MB` : 'Reporte repetido (no cobra)')
    },

    /** 5. Fin del viaje: el sobrante vuelve a Bs por la rampa (aquí, una cuenta que representa la rampa de salida). */
    withdraw(kp: any, amountUsdc: number) {
      return classic(kp, Operation.payment({ destination: topup.publicKey(), asset: usdc, amount: amountUsdc.toFixed(7) }), `Retiro de ${amountUsdc.toFixed(2)} USDC a Bs`)
    },

    async balance(userId: string) {
      return fromUnits(BigInt(await read(DEMO.tokenContractId, 'balance', [addr(userId)])))
    },
    async allowance(userId: string) {
      return fromUnits(BigInt(await read(DEMO.tokenContractId, 'allowance', [addr(userId), addr(DEMO.meterContractId)])))
    },
    Address,
  }
}
