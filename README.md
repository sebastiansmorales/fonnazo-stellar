# Fonnazo · Datos móviles que se pagan por MB

Proyecto de Fonnazo para el National Startups Hackathon 2026, construido sobre **Stellar testnet**.

Fonnazo vende eSIMs de datos a viajeros bolivianos. Hoy, como todo el mercado, vende paquetes cerrados: el viajero compra gigas por las dudas y lo que no usa vence. Aquí construimos otro modelo: el viajero recarga en bolivianos, tiene su saldo en dólares digitales (USDC) y un contrato en Stellar le cobra **solo los megas que consume**. Lo que sobra sigue siendo suyo.

**Demo en vivo:** https://sebastiansmorales.github.io/fonnazo-stellar/

La demo se abre sin iniciar sesión. Cada botón firma y envía una transacción real a Stellar testnet, con su enlace al explorador.

## Cómo funciona

1. **Recarga.** El viajero paga en bolivianos por QR bancario y recibe USDC en su billetera.
2. **Tope de gasto.** Firma una sola vez un permiso (`approve`) sobre su USDC a favor del contrato medidor, con un monto máximo y un vencimiento. Puede bajarlo a cero cuando quiera.
3. **Consumo.** Fonnazo reporta al contrato el consumo **acumulado** de la eSIM. El contrato calcula lo que corresponde según el precio del país y cobra solo la diferencia con `transfer_from`.
4. **Fin del viaje.** El saldo que sobra no vence: queda para el próximo viaje o se retira a bolivianos.

## El contrato medidor

Código en [`contracts/medidor`](contracts/medidor/src/lib.rs) (Soroban, Rust).

- `charge(user, country, cumulative_bytes)` solo puede llamarlo el comercio. Cobra sobre el acumulado, así que **un reporte repetido nunca cobra dos veces** y un reporte que retrocede se rechaza.
- Los precios por país se fijan en el constructor y no se pueden cambiar después. El contrato no es actualizable.
- El tope y el vencimiento los impone el propio token: si no hay saldo o se superó el tope, la transacción entera revierte. No hay cobros parciales.
- Cada cobro emite un evento `Charge` con el país, los bytes y el monto.

Para compilar y correr los tests (Rust 1.92 y `stellar-cli`):

```bash
cd contracts/medidor
cargo test
stellar contract build
```

## La demo web

Código en [`web/`](web) (React + Vite). Es una página estática sin backend: usa el SDK de Stellar en el navegador y firma con cuentas de demostración. El sitio compilado está en [`docs/`](docs), que es lo que publica GitHub Pages.

```bash
cd web
npm install
npm run dev      # desarrollo
npm run build    # genera ../docs
```

### Contratos de la demo (testnet)

| Qué | Dirección |
|---|---|
| Contrato medidor | [`CCDP3AAQY7F2BDCHQCTOW43ZZUJDABOOKTY7BBV5AVVWRXQVSA7FZFXI`](https://stellar.expert/explorer/testnet/contract/CCDP3AAQY7F2BDCHQCTOW43ZZUJDABOOKTY7BBV5AVVWRXQVSA7FZFXI) |
| USDC de prueba | [`CC56NINYVIQAIGLNBBHYHWEWZCUJXE6CZWKEZIPBU7UD2SGZWZGLE74V`](https://stellar.expert/explorer/testnet/contract/CC56NINYVIQAIGLNBBHYHWEWZCUJXE6CZWKEZIPBU7UD2SGZWZGLE74V) |

## Qué es real y qué se simula

- **Real:** el contrato, la billetera, el permiso de gasto, cada cobro y el retiro son transacciones en Stellar testnet. Además del flujo de esta demo, probamos el mismo contrato de punta a punta con una eSIM real en un teléfono: el consumo se cobró solo, cuatro veces, hasta 223 MB.
- **Simulado en la demo:** el pago por QR en bolivianos y el retiro al banco (en producción los hace un proveedor de pagos regulado en Bolivia) y el consumo de datos, que aquí se dispara con botones.
- El USDC es un token de prueba sin valor. Los precios son ilustrativos.

## Nota sobre las llaves

`web/src/demo-config.ts` incluye a propósito las llaves de dos cuentas de demostración en testnet. Hacen falta para que la página firme sus transacciones sin un servidor. No tienen valor ni relación con cuentas reales.

## Qué sigue

- Una billetera Fonnazo dentro de la app, con un custodio registrado, para que el usuario no maneje llaves.
- Recarga y retiro en bolivianos con un proveedor regulado.
- Un piloto con clientes actuales, todavía en testnet.
