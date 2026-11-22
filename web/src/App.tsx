import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ExternalLink, Home, Landmark, User, MapPin, MessageCircle, Plane, Play, QrCode, RotateCcw, ShieldCheck, Wallet, Wifi } from 'lucide-react'
import { Badge } from './arc/vendor/badge/badge'
import { Button } from './arc/vendor/button/button'
import { Stepper } from './arc/vendor/stepper/stepper'
import { TextShimmer } from './arc/vendor/text-shimmer/text-shimmer'
import { CopyButton } from './arc/vendor/copy-button/copy-button'
import { AnimatedCounter } from './arc/vendor/animated-counter/animated-counter'
import SegmentedControl from './arc/vendor/segmented-control/segmented-control'
import { Phone } from './parts/Phone'
import logo from './logo.png'
import chip from './chip.png'
import qrPago from './qr-pago.svg'
import onb1 from './videos/onb1.mp4'
import onb2 from './videos/onb2.mp4'
import onb3 from './videos/onb3.mp4'
import onb1Poster from './videos/onb1.jpg'
import onb2Poster from './videos/onb2.jpg'
import onb3Poster from './videos/onb3.jpg'
import { DEMO } from './demo-config'
import { contractUrl, accountUrl, createFlow, txUrl, type Tx } from './flow'
import lastRun from './last-run.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
const sdk = (window as any).StellarSdk
const flow = createFlow(sdk)
const NBSP = ' '
const PRICE_MB = DEMO.pricePerGb / 1000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const fmt = (n: number, d = 2) => n.toLocaleString('es-BO', { minimumFractionDigits: d, maximumFractionDigits: d })

const PASOS = [
  { id: 'billetera', label: 'Billetera', description: 'Se crea una billetera nueva en Stellar testnet, lista para recibir USDC.' },
  { id: 'recarga', label: 'Recarga en Bs', description: 'Paga Bs 70 por QR (simulado) y recibe 10 USDC reales de prueba.' },
  { id: 'tope', label: 'Tope de gasto', description: 'Autoriza al contrato medidor a cobrarle como máximo este monto.' },
  { id: 'navega', label: 'Navega', description: 'Cada reporte de consumo dispara un cobro del contrato, solo por lo nuevo.' },
  { id: 'fin', label: 'Fin del viaje', description: 'Lo que sobra es suyo: lo retira a Bs por la rampa.' },
]

// Lo que hace la viajera en Brasil: cada uso es un video y, al terminar, un cobro real por sus megas.
const USOS = [
  { src: onb1, poster: onb1Poster, Icon: Camera, t: 'Redes sociales', d: 'Transmite en vivo al llegar', mb: 73 },
  { src: onb2, poster: onb2Poster, Icon: MessageCircle, t: 'Familia', d: 'Le avisa a su papá que llegó', mb: 25 },
  { src: onb3, poster: onb3Poster, Icon: MapPin, t: 'Mapas y apps de pago', d: 'Busca dónde comer cerca', mb: 51 },
]

type Cobro = { mb: number; usdc: number; hash: string; label?: string }

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
  // Recarga dentro del teléfono: 'qr' (se muestra el QR) → 'conv' (Bs se convierten a USDC) → null.
  const [recarga, setRecarga] = useState<null | 'qr' | 'conv'>(null)
  // Paso Navega: qué video se ve (usoIdx) y cuántos usos ya se cobraron (cobrados).
  const [usoIdx, setUsoIdx] = useState(0)
  const [cobrados, setCobrados] = useState(0)
  const mbRef = useRef(0)
  const cobradosRef = useRef(0)
  const cobrando = useRef(false)
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
  const recargar = (k = kp) => run('Recargando: QR en bolivianos y conversión a USDC…', async () => {
    try {
      setRecarga('qr')
      await sleep(2600) // el pago por QR se simula
      setRecarga('conv')
      // La conversión se anima mientras la recarga real viaja a Stellar; se espera a las dos.
      const [tx] = await Promise.all([flow.topUp(k.publicKey(), 10), sleep(2600)])
      add(tx); await refresh(k.publicKey())
      await sleep(700)
      setPaso(2)
    } finally { setRecarga(null) }
  })
  const autorizar = (k = kp, cap = Number(tope)) => run(`Firmando el tope de ${cap} USDC…`, async () => {
    add(await flow.approve(k, cap)); await refresh(k.publicKey()); setPaso(3)
  })
  const consumir = (delta: number, label?: string, k = kp) => run(delta > 0 ? `Cobrando ${delta} MB en Stellar…` : 'Repitiendo el último reporte…', async () => {
    const total = mbRef.current + delta
    const t = await flow.charge(k.publicKey(), total, delta)
    mbRef.current = total
    add(t); setMb(total)
    if (delta > 0) setCobros(c => [{ mb: delta, usdc: delta * PRICE_MB, hash: t.hash, label }, ...c])
    await refresh(k.publicKey())
    return total
  })

  // Mientras Paola navega, cada uso (video) dispara su cobro. El video siguiente espera a que se confirme.
  useEffect(() => {
    if (paso !== 3 || !kp || usoIdx >= USOS.length) return
    if (cobradosRef.current > usoIdx || cobrando.current) return
    cobrando.current = true
    const u = USOS[usoIdx]!
    consumir(u.mb, u.t)
      .catch(() => { /* el error ya se muestra; se sigue con el próximo uso */ })
      .finally(() => { cobrando.current = false; cobradosRef.current = usoIdx + 1; setCobrados(usoIdx + 1) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, kp, usoIdx])

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
      // Los cobros los disparan los videos; se espera a que los tres usos estén cobrados.
      for (let i = 0; i < 240 && cobradosRef.current < USOS.length; i++) { if (!auto.current) return; await sleep(500) }
      await retirar(k)
    } catch { /* el error ya se muestra */ } finally { auto.current = false }
  }

  const reiniciar = () => {
    setPaso(0); setTxs([]); setKp(null); setSaldo(0); setPermiso(0); setMb(0); setCobros([]); setRetirado(null); setError(null); setUsoIdx(0); setCobrados(0); mbRef.current = 0; cobradosRef.current = 0
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
        <h1 className="title-xl">Internet en el exterior que se paga <span className="grad">por{NBSP}MB, con{NBSP}USDC</span></h1>
        <p className="lede">
          El viajero recarga en bolivianos y un contrato en Stellar le cobra solo los megas que usa. Cada botón de
          esta página firma una transacción real en Stellar testnet.
        </p>
        <div className="hero-actions">
          <Button onClick={todo} disabled={!!busy} loading={!!busy && auto.current}><Play size={14} /> Ejecutar la demo completa</Button>
          <Button variant="ghost" onClick={reiniciar} disabled={!!busy}><RotateCcw size={14} /> Empezar de nuevo</Button>
        </div>
      </section>

      <section className="story panel">
        <div><strong>45{NBSP}%</strong><span>de los datos de las eSIMs internacionales vence sin usarse</span></div>
        <div><b>Hoy</b><span>Paquetes cerrados: lo que sobra se pierde</span></div>
        <div><b>Con Fonnazo</b><span>Pagas por MB y lo que sobra sigue siendo tuyo</span></div>
      </section>

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
                <p>Toca <b>Recargar</b> en el teléfono: se abre el QR bancario por Bs 70 (simulado) y los bolivianos se convierten en 10 USDC reales de prueba.</p>
                <Button onClick={() => recargar()} disabled={!!busy}><QrCode size={14} /> Recargar Bs 70</Button>
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
                <p>Paola usa sus apps en Brasil. Cada uso se reporta al contrato y se cobra solo, a {fmt(PRICE_MB, 3)} USDC por MB.</p>
                <div className="consumos">
                  {USOS.map((u, k) => (
                    <div key={u.t} className="consumo" data-estado={k < cobrados ? 'ok' : k === usoIdx ? 'ahora' : 'pendiente'}>
                      <u.Icon size={14} />
                      <span><b>{u.t}</b><small>{u.mb} MB · {fmt(u.mb * PRICE_MB, 3)} USDC</small></span>
                      <em>{k < cobrados ? 'Cobrado' : k === usoIdx ? 'Usando datos…' : 'Pendiente'}</em>
                    </div>
                  ))}
                </div>
                <div className="row-actions">
                  <Button variant="secondary" size="sm" onClick={() => { void consumir(0).catch(() => {}) }} disabled={!!busy || mb === 0}>Repetir el último reporte (no cobra)</Button>
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
          <Phone width={300}>
            <AppScreen paso={paso} saldo={saldo} permiso={permiso} mb={mb} cobrado={cobrado} cobros={cobros} retirado={retirado} wallet={kp?.publicKey()} recarga={recarga} onRecargar={paso === 1 && !busy ? () => { void recargar().catch(() => {}) } : undefined} />
          </Phone>
          <UsoEnVivo activa={paso === 3} idx={usoIdx} puedeAvanzar={cobrados > usoIdx || usoIdx >= USOS.length} onFin={() => setUsoIdx(i => i + 1)} />
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

      <section className="notes">
        <div className="panel">
          <h2>En esta demo</h2>
          <ul className="bullets">
            <li>El contrato, el tope de gasto, los cobros y el retiro son <b>transacciones reales</b> en Stellar testnet.</li>
            <li>El pago por QR, el retiro al banco y el consumo de datos <b>se simulan</b>. El USDC es de prueba.</li>
            <li>Un reporte repetido <b>no cobra dos veces</b>: el contrato cobra sobre el consumo acumulado.</li>
          </ul>
        </div>
        <div className="panel">
          <h2>Verificable</h2>
          <div className="ids">
            <span>Medidor</span><code>{DEMO.meterContractId.slice(0, 10)}…</code><CopyButton value={DEMO.meterContractId} label="Copiar" iconOnly />
            <span>USDC de prueba</span><code>{DEMO.tokenContractId.slice(0, 10)}…</code><CopyButton value={DEMO.tokenContractId} label="Copiar" iconOnly />
          </div>
          <details className="evidence">
            <summary>Corrida completa verificada ({lastRun.txs.length} transacciones)</summary>
            <ol>
              {lastRun.txs.map(t => (
                <li key={t.hash}><span>{t.what}</span><a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="mono-link">{t.hash.slice(0, 10)}… <ExternalLink size={11} /></a></li>
              ))}
            </ol>
          </details>
          <a className="link small" href="https://github.com/sebastiansmorales/fonnazo-stellar" target="_blank" rel="noreferrer">Código y contrato en GitHub <ExternalLink size={11} /></a>
        </div>
      </section>

      <footer className="foot-bar">Fonnazo · fonnazo.com · Demo en Stellar testnet, sin dinero real</footer>
    </div>
  )
}

function AppScreen({ paso, saldo, permiso, mb, cobrado, cobros, retirado, wallet, recarga, onRecargar }: { paso: number; saldo: number; permiso: number; mb: number; cobrado: number; cobros: Cobro[]; retirado: number | null; wallet?: string; recarga: null | 'qr' | 'conv'; onRecargar?: () => void }) {
  return (
    <>
      <div className="app-head">
        <div className="app-status"><span>9:41</span><span className="app-island" /><span className="app-status-icons">●●●</span></div>
        <div className="app-top"><span>Saldo</span></div>
      </div>
      <div className="app-scroll">
      <Ruta llego={paso >= 3} />
      <div className="app-card saldo-card">
        <div className="saldo-main">
          <span className="app-cap">Tu saldo</span>
          <strong className="app-big"><AnimatedCounter value={+saldo.toFixed(3)} decimals={3} suffix={`${NBSP}USDC`} locale="es-BO" /></strong>
          <span className="app-sub">{wallet ? `Billetera ${wallet.slice(0, 4)}…${wallet.slice(-4)}` : 'Sin billetera todavía'}</span>
        </div>
        <div className="saldo-logos" aria-label="USDC sobre Stellar">
          <span><LogoUSDC /><small>USDC</small></span>
          <span><LogoStellar /><small>Stellar</small></span>
        </div>
      </div>
      {paso === 1 && (
        <button type="button" className="app-btn app-recargar" onClick={onRecargar} disabled={!onRecargar}><QrCode size={12} /> Recargar</button>
      )}
      <div className="chip-wrap" data-chico={paso >= 3 || undefined} aria-hidden="true">
        <div className="chip">
          <img src={chip} alt="" />
          <span className="chip-flag"><BanderaBR /></span>
        </div>
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
          {cobros.map(c => (
            <div className="app-row nuevo" key={c.hash}>
              <span className="app-ico"><Wifi size={11} /></span>
              <span className="app-row-t"><b>{c.label ?? `${c.mb} MB`}</b><small>{c.mb} MB · {c.hash.slice(0, 6)}…</small></span>
              <span className="app-neg">− {fmt(c.usdc, 3)} USDC</span>
            </div>
          ))}
        </>
      )}
      </div>
      <Recarga fase={recarga} />
      <nav className="app-tabs" aria-hidden="true">
        <span><Home size={15} />Tienda</span>
        <span className="on"><Wallet size={15} />Saldo</span>
        <span><User size={15} />Perfil</span>
      </nav>
    </>
  )
}

/** Hoja de recarga dentro del teléfono: primero el QR bancario, después la conversión de Bs a USDC. */
function Recarga({ fase }: { fase: null | 'qr' | 'conv' }) {
  // Los contadores arrancan en Bs 70 / 0 USDC y ruedan a 0 / 10 al entrar en la conversión.
  const [convertido, setConvertido] = useState(false)
  useEffect(() => {
    if (fase !== 'conv') { setConvertido(false); return }
    const t = window.setTimeout(() => setConvertido(true), 450)
    return () => window.clearTimeout(t)
  }, [fase])
  return (
    <div className="sheet" data-on={fase ? '' : undefined} aria-hidden={!fase}>
      <span className="sheet-grip" />
      {fase !== 'conv' ? (
        <>
          <b className="sheet-title">Escanea para pagar</b>
          <span className="sheet-sub">Abre tu app bancaria boliviana y escanea este QR</span>
          <div className="sheet-qr"><img src={qrPago} alt="" /></div>
          <span className="app-cap">Monto a pagar</span>
          <strong className="sheet-monto">Bs 70,00</strong>
          <span className="sheet-wait"><TextShimmer>Esperando confirmación del pago…</TextShimmer></span>
        </>
      ) : (
        <>
          <span className="app-check sheet-ok"><Check size={20} /></span>
          <b className="sheet-title">Pago recibido</b>
          <span className="sheet-sub">Convirtiendo tus bolivianos a dólares digitales</span>
          <div className="conv">
            <div className="conv-side">
              <span className="conv-flag"><BanderaBO /></span>
              <strong><AnimatedCounter value={convertido ? 0 : 70} decimals={2} prefix={`Bs${NBSP}`} locale="es-BO" /></strong>
              <small>Bolivianos</small>
            </div>
            <div className="conv-arrow" data-on={convertido || undefined}><span /><span /><span /></div>
            <div className="conv-side">
              <span className="conv-coin">$</span>
              <strong><AnimatedCounter value={convertido ? 10 : 0} decimals={2} locale="es-BO" /></strong>
              <small>USDC</small>
            </div>
          </div>
          <span className="sheet-wait"><TextShimmer>Enviando a tu billetera en Stellar…</TextShimmer></span>
        </>
      )}
    </div>
  )
}

/* Marcas del saldo: USDC y la red Stellar. */
function LogoUSDC() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <path fill="#fff" d="M20.4 18.5c0-2.3-1.4-3.1-4.2-3.4-2-.3-2.4-.8-2.4-1.7s.7-1.5 2-1.5c1.2 0 1.9.4 2.2 1.4.1.2.3.3.5.3h1c.3 0 .5-.2.5-.5v-.1c-.3-1.5-1.5-2.6-3.1-2.8V8.7c0-.3-.2-.5-.6-.6h-1c-.3 0-.5.2-.6.6v1.5c-2 .3-3.3 1.6-3.3 3.3 0 2.2 1.3 3 4.1 3.4 1.9.3 2.5.7 2.5 1.8s-.9 1.8-2.2 1.8c-1.700 0-2.300-.700-2.500-1.700-.100-.300-.300-.400-.500-.400h-1.100c-.300 0-.500.200-.500.500v.100c.300 1.700 1.300 2.900 3.500 3.200v1.600c0 .300.200.500.600.600h1c.300 0 .500-.200.600-.600v-1.600c2-.300 3.300-1.700 3.300-3.500z" />
      <path fill="#fff" d="M12.800 25.300c-5.200-1.900-7.900-7.700-5.900-12.800 1-2.800 3.200-4.900 5.900-5.900.300-.100.400-.300.400-.700V5c0-.300-.100-.500-.400-.600-.100 0-.200 0-.300.100-6.300 2-9.800 8.700-7.800 15 1.200 3.700 4.100 6.600 7.800 7.800.300.100.600 0 .700-.300.100-.100.100-.200.100-.300v-.900c0-.200-.200-.500-.500-.500zm6.700-20.800c-.300-.100-.600 0-.700.300-.100.100-.100.200-.100.300v.900c0 .300.200.500.400.700 5.200 1.900 7.900 7.700 5.900 12.800-1 2.800-3.200 4.900-5.900 5.900-.300.100-.400.300-.400.700v.900c0 .300.100.500.400.600.100 0 .200 0 .300-.100 6.300-2 9.800-8.700 7.800-15-1.200-3.800-4.200-6.700-7.700-8z" />
    </svg>
  )
}
function LogoStellar() {
  // Marca de Stellar simplificada: un anillo atravesado por dos trazos diagonales.
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#fff" />
      <g fill="none" stroke="#0d0616" strokeWidth="2.3" strokeLinecap="round">
        <path d="M9.300 19.200a7.300 7.300 0 0 1 12.900-6.400" />
        <path d="M22.700 12.800a7.300 7.300 0 0 1-12.900 6.400" />
        <path d="M5.500 18.600 26.500 8.400" />
        <path d="M5.500 23.600 26.500 13.400" />
      </g>
    </svg>
  )
}

/* Banderas en SVG: se ven igual en cualquier sistema (los emoji de bandera no existen en Windows). */
function BanderaBR() {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true">
      <rect width="28" height="20" fill="#009c3b" />
      <path d="M14 2.6 25.2 10 14 17.4 2.8 10Z" fill="#ffdf00" />
      <circle cx="14" cy="10" r="4.3" fill="#002776" />
      <path d="M9.9 9.1c2.9-.5 5.9.1 8.3 1.7" stroke="#fff" strokeWidth=".9" fill="none" />
    </svg>
  )
}
function BanderaBO() {
  return (
    <svg viewBox="0 0 28 20" aria-hidden="true">
      <rect width="28" height="6.7" fill="#d52b1e" /><rect y="6.7" width="28" height="6.6" fill="#f9e300" /><rect y="13.3" width="28" height="6.7" fill="#007934" />
    </svg>
  )
}

/** La viajera: sale de Santa Cruz y llega a São Paulo. El avión vuela hasta que empieza a navegar. */
function Ruta({ llego }: { llego: boolean }) {
  return (
    <div className="ruta" data-llego={llego || undefined}>
      <div className="ruta-line">
        <span className="ruta-flag"><BanderaBO /></span>
        <span className="ruta-track"><span className="ruta-plane"><Plane size={12} /></span></span>
        <span className="ruta-flag"><BanderaBR /></span>
      </div>
      <span className="ruta-text">
        {llego ? <><span className="app-dot ok" /> Paola, de Santa Cruz, ya está en São Paulo</> : 'Paola viaja de Santa Cruz a São Paulo'}
      </span>
    </div>
  )
}

/** De cada video se muestran solo los primeros segundos, en bucle, para que el paso sea corto. */
const CLIP_S = 2

/** Segundo teléfono: la viajera usando sus apps. Los megas suben mientras corre el video. */
function UsoEnVivo({ activa, idx, puedeAvanzar, onFin }: { activa: boolean; idx: number; puedeAvanzar: boolean; onFin: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [progreso, setProgreso] = useState(0)
  const uso = USOS[idx % USOS.length]!
  const primeraVuelta = idx < USOS.length
  const finRef = useRef(onFin)
  finRef.current = onFin
  useEffect(() => {
    const v = ref.current
    if (!v) return
    setProgreso(0)
    if (activa) { v.currentTime = 0; void v.play().catch(() => {}) } else v.pause()
  }, [activa, idx])
  // Los megas suben con el tiempo (hasta el 92 %) y se completan cuando el cobro se confirma.
  useEffect(() => {
    if (!activa) return
    const t0 = performance.now()
    const t = window.setInterval(() => setProgreso(Math.min(0.92, (performance.now() - t0) / 5000)), 120)
    return () => window.clearInterval(t)
  }, [activa, idx])
  // Se pasa al siguiente uso apenas se confirma el cobro (se deja ver "cobrados" un momento).
  // Después de los tres usos, los clips rotan solos.
  useEffect(() => {
    if (!activa || !puedeAvanzar) return
    const t = window.setTimeout(() => finRef.current(), idx < USOS.length ? 900 : CLIP_S * 1000)
    return () => window.clearTimeout(t)
  }, [activa, idx, puedeAvanzar])
  const mbVivo = primeraVuelta ? Math.max(1, Math.round(Math.max(progreso, puedeAvanzar ? 1 : 0) * uso.mb)) : null
  return (
    <div className="uso" data-on={activa || undefined} aria-hidden={!activa}>
      <div className="phone uso-phone">
        <div className="phone-screen">
          <video ref={ref} key={uso.src} src={uso.src} poster={uso.poster} muted playsInline preload="auto"
            onTimeUpdate={e => { const v = e.currentTarget; if (v.currentTime >= CLIP_S) { v.currentTime = 0; void v.play().catch(() => {}) } }} loop />
          <div className="uso-datos">
            <Wifi size={12} />
            {mbVivo !== null ? <><b>{mbVivo} MB</b><span>{puedeAvanzar ? 'cobrados' : 'usando datos…'}</span></> : <span>Sigue navegando</span>}
          </div>
        </div>
      </div>
      <div className="uso-cap">
        <span className="burbuja-ico"><uso.Icon size={14} /></span>
        <span><b>{uso.t}</b><small>{uso.d}</small></span>
      </div>
      <div className="uso-dots">{USOS.map((u, k) => <span key={u.t} data-on={k === idx % USOS.length || undefined} />)}</div>
    </div>
  )
}

export default App
