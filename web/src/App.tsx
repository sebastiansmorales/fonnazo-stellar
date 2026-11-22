import { useCallback, useMemo, useRef, useState } from 'react'
import { Check, ExternalLink, Landmark, Play, QrCode, RotateCcw, ShieldCheck, Wallet, Wifi } from 'lucide-react'
import { Badge } from './arc/vendor/badge/badge'
import { Button } from './arc/vendor/button/button'
import { Stepper } from './arc/vendor/stepper/stepper'
import { TextShimmer } from './arc/vendor/text-shimmer/text-shimmer'
import { CopyButton } from './arc/vendor/copy-button/copy-button'
import { AnimatedCounter } from './arc/vendor/animated-counter/animated-counter'
import SegmentedControl from './arc/vendor/segmented-control/segmented-control'
import { Phone } from './parts/Phone'
import logo from './logo.png'
import { DEMO } from './demo-config'
import { contractUrl, accountUrl, createFlow, txUrl, type Tx } from './flow'
import lastRun from './last-run.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
const sdk = (window as any).StellarSdk
const flow = createFlow(sdk)
const NBSP = ' '
const PRICE_MB = DEMO.pricePerGb / 1000
const fmt = (n: number, d = 2) => n.toLocaleString('es-BO', { minimumFractionDigits: d, maximumFractionDigits: d })

const PASOS = [
  { id: 'billetera', label: 'Billetera', description: 'Se crea una billetera nueva en Stellar testnet, lista para recibir USDC.' },
  { id: 'recarga', label: 'Recarga en Bs', description: 'Paga Bs 70 por QR (simulado) y recibe 10 USDC reales de prueba.' },
  { id: 'tope', label: 'Tope de gasto', description: 'Autoriza al contrato medidor a cobrarle como máximo este monto.' },
  { id: 'navega', label: 'Navega', description: 'Cada reporte de consumo dispara un cobro del contrato, solo por lo nuevo.' },
  { id: 'fin', label: 'Fin del viaje', description: 'Lo que sobra es suyo: lo retira a Bs por la rampa.' },
]

const CONSUMOS = [
  { mb: 25, label: 'Mensajes y mapas', sub: '25 MB' },
  { mb: 51, label: 'Redes sociales', sub: '51 MB' },
  { mb: 73, label: 'Un video corto', sub: '73 MB' },
]

type Cobro = { mb: number; usdc: number; hash: string }

export function App() {
  const [paso, setPaso] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [kp, setKp] = useState<any>(null)
  const [saldo, setSaldo] = useState(0)
  const [tope, setTope] = useState('5')
  const [permiso, setPermiso] = useState(0)
  const [mb, setMb] = useState(0)
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [retirado, setRetirado] = useState<number | null>(null)
  const auto = useRef(false)

  const refresh = useCallback(async (id: string) => {
    const [b, a] = await Promise.all([flow.balance(id), flow.allowance(id)])
    setSaldo(b); setPermiso(a)
  }, [])

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label); setError(null)
    try { return await fn() } catch (e: any) { setError(e?.message ?? String(e)); auto.current = false; throw e } finally { setBusy(null) }
  }, [])

  const add = (t: Tx | Tx[]) => setTxs(prev => [...(Array.isArray(t) ? [...t].reverse() : [t]), ...prev])

  const crear = () => run('Creando la billetera en Stellar testnet…', async () => {
    const r = await flow.createWallet()
    setKp(r.kp); add(r.txs); await refresh(r.kp.publicKey()); setPaso(1)
    return r.kp
  })
  const recargar = (k = kp) => run('Pago confirmado · enviando 10 USDC a la billetera…', async () => {
    add(await flow.topUp(k.publicKey(), 10)); await refresh(k.publicKey()); setPaso(2)
  })
  const autorizar = (k = kp, cap = Number(tope)) => run(`Firmando el tope de ${cap} USDC…`, async () => {
    add(await flow.approve(k, cap)); await refresh(k.publicKey()); setPaso(3)
  })
  const consumir = (delta: number, k = kp, base = mb) => run(`Reportando ${delta} MB al contrato medidor…`, async () => {
    const total = base + delta
    const t = await flow.charge(k.publicKey(), total, delta)
    add(t); setMb(total)
    if (delta > 0) setCobros(c => [{ mb: delta, usdc: delta * PRICE_MB, hash: t.hash }, ...c])
    await refresh(k.publicKey())
    return total
  })
  const retirar = (k = kp) => run('Retirando el sobrante a Bs…', async () => {
    const b = await flow.balance(k.publicKey())
    add(await flow.withdraw(k, b)); setRetirado(b); await refresh(k.publicKey()); setPaso(4)
  })

  const todo = async () => {
    auto.current = true
    try {
      const k = await crear()
      await recargar(k)
      await autorizar(k, Number(tope))
      let total = 0
      for (const c of CONSUMOS) { if (!auto.current) return; total = await consumir(c.mb, k, total) }
      await retirar(k)
    } catch { /* el error ya se muestra */ } finally { auto.current = false }
  }

  const reiniciar = () => {
    setPaso(0); setTxs([]); setKp(null); setSaldo(0); setPermiso(0); setMb(0); setCobros([]); setRetirado(null); setError(null)
  }

  const cobrado = useMemo(() => cobros.reduce((s, c) => s + c.usdc, 0), [cobros])

  return (
    <div className="deck demo" data-arc="" data-theme="dark" data-accent="orange">
      <header className="top">
        <img src={logo} alt="Fonnazo" className="top-logo" />
        <div className="top-right">
          <Badge tone="info" dot pill>Stellar testnet</Badge>
          <a className="link" href={contractUrl(DEMO.meterContractId)} target="_blank" rel="noreferrer">Contrato medidor <ExternalLink size={12} /></a>
        </div>
      </header>

      <section className="hero">
        <p className="kicker">Demo en vivo · National Startups Hackathon 2026</p>
        <h1 className="title-xl">Datos móviles que se pagan <span className="grad">por MB</span></h1>
        <p className="lede">
          Fonnazo vende eSIMs a viajeros bolivianos. Con este modo el viajero recarga en bolivianos, tiene su saldo en
          dólares digitales y un contrato en Stellar le cobra solo los megas que usa. Lo que sobra sigue siendo suyo.
          Cada botón de esta página firma y envía una transacción real a Stellar testnet.
        </p>
        <div className="hero-actions">
          <Button onClick={todo} disabled={!!busy} loading={!!busy && auto.current}><Play size={14} /> Ejecutar la demo completa</Button>
          <Button variant="ghost" onClick={reiniciar} disabled={!!busy}><RotateCcw size={14} /> Empezar de nuevo</Button>
        </div>
      </section>

      <section className="story">
        <div className="panel story-stat">
          <strong>45{NBSP}%</strong>
          <p>de los datos que compran quienes usan eSIMs internacionales vence sin consumirse.</p>
        </div>
        <div className="panel">
          <h2>El problema</h2>
          <ul className="bullets">
            <li><b>Paquetes cerrados.</b> El viajero compra 3 GB por las dudas, usa uno y el resto vence con el plan.</li>
            <li><b>Pagar en dólares es difícil.</b> Desde Bolivia las tarjetas tienen topes y recargos para pagar afuera.</li>
            <li><b>El sobrante no vuelve.</b> Lo que no se usó no se guarda, no se transfiere y no se devuelve.</li>
          </ul>
        </div>
        <div className="panel">
          <h2>La solución</h2>
          <ul className="bullets">
            <li><b>Pagas solo lo que usas.</b> El cobro es por MB consumido, no por paquete.</li>
            <li><b>Recargas en bolivianos.</b> Con QR desde el banco, sin tarjeta internacional.</li>
            <li><b>Lo que sobra sigue siendo tuyo.</b> El saldo está en dólares digitales, no vence y se puede retirar.</li>
          </ul>
        </div>
      </section>

      <h2 className="section-title" id="demo">Pruébalo: cada paso es una transacción real</h2>

      <main className="grid">
        <section className="panel steps-panel">
          <div className="steps-big">
            <Stepper steps={PASOS} current={paso} orientation="vertical" details="current" label="Pasos de la demo" completeLabel="Demo completa" />
          </div>

          <div className="action">
            {paso === 0 && (
              <>
                <p>Empezamos creando la billetera del viajero. En el producto vive dentro de la app y el usuario nunca ve llaves.</p>
                <Button onClick={crear} disabled={!!busy}><Wallet size={14} /> Crear billetera</Button>
              </>
            )}
            {paso === 1 && (
              <>
                <div className="qr-sim">
                  <QrCode size={44} />
                  <div><strong>Bs 70,00</strong><span>QR bancario boliviano · simulado en la demo</span></div>
                </div>
                <Button onClick={() => recargar()} disabled={!!busy}><Check size={14} /> Pagué el QR</Button>
              </>
            )}
            {paso === 2 && (
              <>
                <p>¿Hasta cuánto puede cobrar Fonnazo? El contrato no puede pasar de este tope.</p>
                <SegmentedControl label="Tope de gasto" options={[{ value: '3', label: '3 USDC' }, { value: '5', label: '5 USDC' }, { value: '10', label: '10 USDC' }]} value={tope} onValueChange={setTope} />
                <Button onClick={() => autorizar()} disabled={!!busy}><ShieldCheck size={14} /> Autorizar tope</Button>
              </>
            )}
            {paso === 3 && (
              <>
                <p>Simula consumo de datos. A {fmt(PRICE_MB, 3)} USDC por MB, cada reporte cobra solo lo nuevo.</p>
                <div className="consumos">
                  {CONSUMOS.map(c => (
                    <button key={c.mb} type="button" className="consumo" onClick={() => consumir(c.mb)} disabled={!!busy}>
                      <Wifi size={14} /><span><b>{c.label}</b><small>{c.sub} · {fmt(c.mb * PRICE_MB, 3)} USDC</small></span>
                    </button>
                  ))}
                </div>
                <div className="row-actions">
                  <Button variant="secondary" size="sm" onClick={() => consumir(0)} disabled={!!busy || mb === 0}>Repetir el último reporte (no cobra)</Button>
                  <Button size="sm" onClick={() => retirar()} disabled={!!busy}><Landmark size={14} /> Terminar el viaje</Button>
                </div>
              </>
            )}
            {paso === 4 && (
              <>
                <p>Viaje terminado. El viajero usó {mb} MB, pagó {fmt(cobrado, 3)} USDC y retiró {fmt(retirado ?? 0)} USDC a su banco en Bs.</p>
                <Button variant="secondary" onClick={reiniciar}><RotateCcw size={14} /> Probar de nuevo</Button>
              </>
            )}
            {busy && <p className="busy"><TextShimmer>{busy}</TextShimmer></p>}
            {error && <p className="error">No se pudo completar: {error}. Prueba de nuevo en unos segundos (testnet a veces tarda).</p>}
          </div>
        </section>

        <section className="phone-col">
          <Phone width={260}>
            <AppScreen paso={paso} saldo={saldo} permiso={permiso} mb={mb} cobrado={cobrado} cobros={cobros} retirado={retirado} wallet={kp?.publicKey()} />
          </Phone>
        </section>

        <section className="panel log">
          <div className="log-head"><h2>Transacciones en Stellar</h2><span>{txs.length}</span></div>
          {txs.length === 0 ? (
            <p className="muted">Aparecen aquí a medida que avanzas, con su enlace al explorador.</p>
          ) : (
            <ul>
              {txs.map(t => (
                <li key={t.hash}>
                  <span className="dot-ok"><Check size={11} /></span>
                  <span className="log-what">{t.what}</span>
                  <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="mono-link">{t.hash.slice(0, 8)}… <ExternalLink size={11} /></a>
                </li>
              ))}
            </ul>
          )}
          {kp && <a className="link small" href={accountUrl(kp.publicKey())} target="_blank" rel="noreferrer">Ver la billetera en el explorador <ExternalLink size={11} /></a>}
        </section>
      </main>

      <section className="evidence panel">
        <h2>Ejecución verificada</h2>
        <p className="muted">
          La misma secuencia corrida de punta a punta el {new Date(lastRun.at).toLocaleString('es-BO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/La_Paz' })} (hora de Bolivia).
          Incluye un reporte repetido que no vuelve a cobrar.
        </p>
        <ol>
          {lastRun.txs.map(t => (
            <li key={t.hash}><span>{t.what}</span><a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="mono-link">{t.hash.slice(0, 10)}… <ExternalLink size={11} /></a></li>
          ))}
        </ol>
      </section>

      <section className="how">
        <div className="panel">
          <h2>Cómo funciona</h2>
          <ul className="bullets">
            <li>El viajero firma <b>una sola vez</b> un permiso de gasto (<code>approve</code>) sobre su USDC a favor del contrato medidor, con tope y vencimiento.</li>
            <li>Fonnazo reporta el consumo <b>acumulado</b> de la eSIM; el contrato cobra la diferencia con <code>transfer_from</code>. Un reporte repetido no cobra dos veces.</li>
            <li>Los precios por país quedan fijos al desplegar el contrato y no se pueden cambiar.</li>
            <li>Si no hay saldo o se llegó al tope, el cobro no pasa y la línea se corta antes.</li>
          </ul>
        </div>
        <div className="panel">
          <h2>En esta demo</h2>
          <ul className="bullets">
            <li>Todo corre en <b>Stellar testnet</b> con un USDC de prueba sin valor.</li>
            <li>El pago por QR en bolivianos y la rampa de salida se simulan; en producción los hace un proveedor de pagos regulado en Bolivia.</li>
            <li>El consumo se simula con botones; en el piloto viene del proveedor de la eSIM.</li>
          </ul>
          <div className="ids">
            <span>Medidor</span><code>{DEMO.meterContractId.slice(0, 10)}…</code><CopyButton value={DEMO.meterContractId} label="Copiar" iconOnly />
            <span>USDC de prueba</span><code>{DEMO.tokenContractId.slice(0, 10)}…</code><CopyButton value={DEMO.tokenContractId} label="Copiar" iconOnly />
          </div>
        </div>
      </section>

      <section className="deck-sections">
        <div className="panel wide">
          <h2>Qué es Fonnazo</h2>
          <p className="body">
            Fonnazo es una app para comprar eSIMs de datos para viajar. El viajero boliviano elige su destino, paga en
            bolivianos con QR desde su banco y se conecta al llegar, sin chip físico y sin roaming. Es una empresa en
            marcha, con clientes que compran todas las semanas: ya emitimos eSIMs para 29 países, con Brasil, Chile,
            Argentina, Perú y China como destinos principales, y una comunidad de 16 mil seguidores en TikTok. El pago
            por MB se monta sobre esta base: los mismos clientes, la misma app.
          </p>
        </div>

        <div className="panel wide">
          <h2>Frente a las alternativas</h2>
          <p className="muted">Otros cobran por consumo con crédito de tienda. El saldo de Fonnazo es del usuario.</p>
          <div className="cmp" role="table">
            <div className="cmp-row cmp-head" role="row"><span role="columnheader" /><span role="columnheader">Paquete por GB</span><span role="columnheader">Saldo de tienda</span><span role="columnheader" className="hl">Fonnazo</span></div>
            {[
              ['Pagas solo lo que consumes', 'No', 'Sí', 'Sí'],
              ['El saldo es tuyo: se retira o se transfiere', 'No', 'No', 'Sí'],
              ['Recargas en bolivianos, sin tarjeta internacional', 'No', 'No', 'Sí'],
              ['Cada cobro se puede verificar en la red', 'No', 'No', 'Sí'],
            ].map(r => (
              <div className="cmp-row" role="row" key={r[0]}>
                <span role="cell">{r[0]}</span>
                {r.slice(1).map((v, i) => <span role="cell" key={i} className={v === 'Sí' ? 'yes' : 'no'}>{v}</span>)}
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Por qué Stellar</h2>
          <ul className="bullets">
            <li><b>Comisiones mínimas.</b> Una transferencia cuesta alrededor de 0,001 XLM, así que cobrar cada bloque de megas es viable.</li>
            <li><b>USDC nativo.</b> Dólares digitales emitidos en la red, sin puentes de por medio.</li>
            <li><b>Contratos Soroban.</b> El medidor fija el precio por país, el tope lo pone el usuario y cada cobro queda registrado.</li>
          </ul>
        </div>
        <div className="panel">
          <h2>Modelo de negocio</h2>
          <ul className="bullets">
            <li><b>Margen por MB.</b> Precio por país sobre el costo mayorista del mega. El margen no depende de que el cliente desperdicie datos.</li>
            <li><b>Clientes que vuelven.</b> Si el saldo no se pierde, el viajero recarga sin miedo y vuelve en el próximo viaje.</li>
            <li><b>Sin costo de adquisición nuevo.</b> Se activa como un modo más de la app para los clientes actuales.</li>
          </ul>
        </div>
        <div className="panel wide">
          <h2>Lo que sigue</h2>
          <ol className="bullets">
            <li><b>Billetera Fonnazo.</b> El saldo vive en una billetera de Fonnazo con un custodio registrado; el usuario no maneja llaves.</li>
            <li><b>Recarga y retiro en bolivianos</b> con un proveedor de pagos regulado.</li>
            <li><b>Piloto con clientes actuales,</b> todavía en testnet.</li>
            <li><b>Más allá de los datos:</b> el mismo saldo para otros gastos del viaje.</li>
          </ol>
          <p className="muted repo">Código y contrato: <a className="link" href="https://github.com/sebastiansmorales/fonnazo-stellar" target="_blank" rel="noreferrer">github.com/sebastiansmorales/fonnazo-stellar</a></p>
        </div>
      </section>

      <footer className="foot-bar">Fonnazo · fonnazo.com · Demo en Stellar testnet, sin dinero real</footer>
    </div>
  )
}

function AppScreen({ paso, saldo, permiso, mb, cobrado, cobros, retirado, wallet }: { paso: number; saldo: number; permiso: number; mb: number; cobrado: number; cobros: Cobro[]; retirado: number | null; wallet?: string }) {
  return (
    <>
      <div className="app-status"><span>9:41</span><span className="app-island" /><span className="app-status-icons">●●●</span></div>
      <div className="app-top"><span>{paso >= 3 ? 'Mi eSIM' : 'Saldo'}</span></div>
      {paso >= 3 && <div className="app-pill-ok"><span className="app-dot ok" />Conectado en Brasil</div>}
      <div className="app-card grad-card">
        <span className="app-cap">Tu saldo</span>
        <strong className="app-big"><AnimatedCounter value={+saldo.toFixed(3)} decimals={3} suffix={`${NBSP}USDC`} locale="es-BO" /></strong>
        <span className="app-sub">{wallet ? `Billetera ${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'Sin billetera todavía'}</span>
      </div>
      <div className="app-card">
        <div className="app-two">
          <span><span className="app-cap">Consumido</span><strong className="app-mid">{mb} MB</strong></span>
          <span><span className="app-cap">Cobrado</span><strong className="app-mid">{fmt(cobrado, 3)}</strong></span>
        </div>
        <span className="app-sub">Tope disponible: {fmt(permiso, 3)} USDC</span>
      </div>
      {paso === 4 && retirado !== null ? (
        <div className="app-center">
          <span className="app-check"><Check size={20} /></span>
          <span className="app-cap">Retiraste a tu banco</span>
          <strong className="app-big">{fmt(retirado)} <small>USDC</small></strong>
        </div>
      ) : (
        <>
          <p className="app-label">Cobros en Stellar</p>
          {cobros.length === 0 && <p className="app-note">Todavía no hay cobros.</p>}
          {cobros.slice(0, 4).map(c => (
            <div className="app-row" key={c.hash}>
              <span className="app-ico"><Wifi size={11} /></span>
              <span className="app-row-t"><b>{c.mb} MB</b><small>{c.hash.slice(0, 6)}…</small></span>
              <span className="app-neg">− {fmt(c.usdc, 3)}</span>
            </div>
          ))}
        </>
      )}
    </>
  )
}

export default App
