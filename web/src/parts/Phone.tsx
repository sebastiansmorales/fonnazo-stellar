import type { CSSProperties, ReactNode } from 'react'
import { BatteryFull, Check, ChevronLeft, Landmark, QrCode, ShieldCheck, Signal, Wifi } from 'lucide-react'

/** Marco de iPhone en CSS: bisel, Dynamic Island y resplandor violeta. Lleva una captura o una pantalla en HTML. */
export function Phone({ src, alt, children, width = 220, className, style }: { src?: string; alt?: string; children?: ReactNode; width?: number; className?: string; style?: CSSProperties }) {
  return (
    <div className={['phone', className].filter(Boolean).join(' ')} style={{ width, ...style }}>
      <div className="phone-screen">
        {src ? <img src={src} alt={alt ?? ''} /> : <div className="app">{children}</div>}
      </div>
    </div>
  )
}

/* ── Pantallas del modo pago por MB, con el estilo de la app (fondo #0A0613, gradiente de marca) ── */

function StatusBar() {
  return (
    <div className="app-status">
      <span>9:41</span>
      <span className="app-island" />
      <span className="app-status-icons"><Signal size={10} /><Wifi size={10} /><BatteryFull size={12} /></span>
    </div>
  )
}

function Top({ title }: { title: string }) {
  return (
    <div className="app-top">
      <span className="app-back"><ChevronLeft size={12} /></span>
      <span>{title}</span>
    </div>
  )
}

export function PantallaSaldo() {
  return (
    <>
      <StatusBar />
      <Top title="Saldo" />
      <div className="app-card grad-card">
        <span className="app-cap">Tu saldo</span>
        <strong className="app-big">10,00 <small>USDC</small></strong>
        <span className="app-sub">≈ Bs 69,60</span>
      </div>
      <div className="app-chip"><span className="app-dot" />Dólares digitales en Stellar</div>
      <p className="app-label">Movimientos</p>
      <div className="app-row">
        <span className="app-ico"><QrCode size={11} /></span>
        <span className="app-row-t"><b>Recarga por QR</b><small>Hace 2 min</small></span>
        <span className="app-pos">+ Bs 70,00</span>
      </div>
      <div className="app-row">
        <span className="app-ico"><Check size={11} /></span>
        <span className="app-row-t"><b>Convertido a USDC</b><small>Hace 2 min</small></span>
        <span className="app-pos">+ 10,00</span>
      </div>
    </>
  )
}

export function PantallaTope() {
  return (
    <>
      <StatusBar />
      <Top title="Tope de gasto" />
      <div className="app-center">
        <span className="app-shield"><ShieldCheck size={20} /></span>
        <span className="app-cap">Fonnazo puede cobrarte hasta</span>
        <strong className="app-big">10 <small>USDC</small></strong>
      </div>
      <div className="app-seg">
        <span>5</span><span className="on">10</span><span>20</span><span>Todo</span>
      </div>
      <p className="app-note">Solo se cobra lo que consumes, dentro de este tope. Lo bajas a cero cuando quieras.</p>
      <div className="app-btn">Guardar tope</div>
    </>
  )
}

export function PantallaNavega() {
  const cobros = [
    { mb: 73, usdc: '0,29', t: 'Hace 1 min' },
    { mb: 73, usdc: '0,29', t: 'Hace 6 min' },
    { mb: 51, usdc: '0,20', t: 'Hace 14 min' },
    { mb: 25, usdc: '0,10', t: 'Hace 20 min' },
  ]
  return (
    <>
      <StatusBar />
      <Top title="Mi eSIM" />
      <div className="app-pill-ok"><span className="app-dot ok" />Conectado en Brasil</div>
      <div className="app-card">
        <div className="app-two">
          <span><span className="app-cap">Consumido</span><strong className="app-mid">222 MB</strong></span>
          <span><span className="app-cap">Cobrado</span><strong className="app-mid">0,88 USDC</strong></span>
        </div>
        <div className="app-progress"><span style={{ width: '9%' }} /></div>
        <span className="app-sub">Saldo 9,12 USDC · tope 10 USDC</span>
      </div>
      <p className="app-label">Cobros en Stellar</p>
      {cobros.map((c, i) => (
        <div className="app-row" key={i}>
          <span className="app-ico"><Wifi size={11} /></span>
          <span className="app-row-t"><b>{c.mb} MB</b><small>{c.t}</small></span>
          <span className="app-neg">− {c.usdc}</span>
        </div>
      ))}
    </>
  )
}

export function PantallaSobra() {
  return (
    <>
      <StatusBar />
      <Top title="Fin del viaje" />
      <div className="app-center">
        <span className="app-check"><Check size={22} /></span>
        <span className="app-cap">Usaste 222 MB en Brasil</span>
        <span className="app-cap">Te quedan</span>
        <strong className="app-big">9,12 <small>USDC</small></strong>
        <span className="app-sub">≈ Bs 63,50 · no vencen</span>
      </div>
      <div className="app-btn">Guardar para el próximo viaje</div>
      <div className="app-btn ghost"><Landmark size={11} /> Retirar a mi banco</div>
    </>
  )
}
