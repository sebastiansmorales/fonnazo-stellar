# Fonnazo · Internet en el exterior que se paga por MB, con USDC

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

## El reporter de consumo

Código en [`reporter/`](reporter/reporter.ts). Es el servicio que convierte el consumo de la eSIM en cobros: consulta cada cierto tiempo los bytes acumulados que informa el proveedor de la eSIM y llama a `charge(user, country, cumulative_bytes)` cuando avanzaron. Es la versión reducida del servicio del piloto; las credenciales del proveedor van por variables de entorno.

```bash
cd reporter
npm install
npm run demo     # crea una billetera, simula una eSIM que consume datos y la cobra en testnet
```

Salida de una corrida real de `npm run demo` (22-nov-2026): tres cobros de 20 MB ([1](https://stellar.expert/explorer/testnet/tx/e6ea6d91580ca3c22815a42e06392224f80afe7af6c390d32402334b3b48d345), [2](https://stellar.expert/explorer/testnet/tx/35ac29861df4c81de2865d412bbf883667865f50382a533548681dcbbfdf8b01), [3](https://stellar.expert/explorer/testnet/tx/6c4b2ce88bf8d5ccf8334335160054458e586d025bd0e6321778a146129e74a3)) y una cuarta consulta sin consumo nuevo, que no cobró.

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

## Prueba con una eSIM real (verificable)

Antes de armar esta demo probamos el contrato con una eSIM real instalada en un teléfono. Un servicio de Fonnazo leyó el consumo del proveedor de la eSIM y llamó a `charge` solo, sin intervención.

- **Contrato del piloto:** [`CC5EXOP6WYZJJ2RDYCSWDCKZEWR2AR7UTI6LAH6HMH6PHCA6WPFQBHPI`](https://stellar.expert/explorer/testnet/contract/CC5EXOP6WYZJJ2RDYCSWDCKZEWR2AR7UTI6LAH6HMH6PHCA6WPFQBHPI)
- **Billetera del usuario:** [`GA63LH…CCET`](https://stellar.expert/explorer/testnet/account/GA63LHISTGRBCZGQ34HZ6Q3J6OUQ6E5QQTGW6XVUEVBXNHTBLUYPCCET)
- **Resultado:** 35 cobros entre el 16 y el 17 de noviembre de 2026 (UTC), hasta un consumo acumulado de 795,7 MiB. Todos son eventos `charge` del contrato y se pueden revisar en el explorador.

Los primeros cuatro cobros (los que citamos en el pitch, 213 MiB = 223 MB):

| # | Cobrado (MiB) | Acumulado (MiB) | Transacción |
|---|---|---|---|
| 1 | 24,00 | 24,00 | [`3bc2405c8f42…`](https://stellar.expert/explorer/testnet/tx/3bc2405c8f42b1d172d26d43f3f00430e0a8acce15e44f207db280d82bdfc617) |
| 2 | 49,00 | 73,00 | [`70548423efdf…`](https://stellar.expert/explorer/testnet/tx/70548423efdf34db315ed42bed7f34e8e09dc7f0cde63af49cc8f163995f9420) |
| 3 | 70,00 | 143,00 | [`38100afd9768…`](https://stellar.expert/explorer/testnet/tx/38100afd97687894f02d11555affafdd1ba3d28c8e4ee24f41b2b7b201f3478a) |
| 4 | 70,00 | 213,00 | [`580883c56830…`](https://stellar.expert/explorer/testnet/tx/580883c568307a245964a4232fdc36d80d94afbe6d7a2aedbc73584a064dcea5) |

### Por qué hay dos contratos

Es el mismo código (`contracts/medidor`), desplegado dos veces en testnet:

- **Piloto** (`CC5EXOP6…QBHPI`): lo usa nuestro backend con la eSIM real. Su llave de comercio es privada. Es el que aparece en el pitch deck.
- **Demo pública** (`CCDP3AAQ…FZFXI`): lo usa esta página. Sus llaves de demostración son públicas a propósito, para que cualquiera pueda ejecutar el flujo sin servidor. Por eso no podía ser el mismo despliegue.

## Qué es real y qué se simula

- **Real:** el contrato, la billetera, el permiso de gasto, cada cobro y el retiro son transacciones en Stellar testnet. Además del flujo de esta demo, probamos el mismo contrato con una eSIM real en un teléfono (ver la sección anterior, con sus transacciones).
- **Simulado en la demo:** el pago por QR en bolivianos y el retiro al banco (en producción los hace un proveedor de pagos regulado en Bolivia) y el consumo de datos, que aquí se dispara con botones.
- El USDC es un token de prueba sin valor. Los precios son ilustrativos.

## Nota sobre las llaves

`web/src/demo-config.ts` incluye a propósito las llaves de dos cuentas de demostración en testnet. Hacen falta para que la página firme sus transacciones sin un servidor. No tienen valor ni relación con cuentas reales.

## Etapa del proyecto

- **En producción, con clientes que pagan:** el negocio actual de Fonnazo, que vende paquetes de datos con pago en bolivianos.
- **Prototipo en testnet:** el pago por MB sobre Stellar que se presenta aquí. Todavía no tiene clientes ni dinero real.

## De dónde sale el 45 %

Es un dato propio de Fonnazo, no un estudio de mercado: sobre las eSIMs que vendimos, comparamos los GB comprados con los GB consumidos al vencer el paquete. Entre 42 % y 45 % no se usó. Creemos que el resto del mercado se comporta parecido porque vende el mismo tipo de paquete, pero no lo hemos medido.

## Economía por MB

- **Costo:** en este modo usamos un proveedor mayorista que factura por MB consumido, no por paquete. El costo de Fonnazo es variable y nace recién cuando el usuario navega.
- **Precio:** cada país tiene un precio por GB fijado en el contrato, igual al costo mayorista más el margen. Los precios de los despliegues en testnet son de prueba.
- **Qué cambia:** hoy parte del margen viene de los GB que el cliente paga y no usa. En el modo por MB ese ingreso desaparece y el margen se gana sobre cada MB consumido. La hipótesis es que se compensa con un precio por MB más alto que el de un paquete grande, y con más uso y recompra de quien hoy no compra por miedo a desperdiciar. El piloto con clientes es para medir eso; todavía no está demostrado.

Números para Brasil, nuestro destino principal (en USD):

| | Viaje liviano (1,1 GB) | Viaje normal (3 GB) |
|---|---|---|
| Ingreso a 4,00 USDC/GB | 4,40 | 12,00 |
| Costo de datos a 1,80/GB | 1,98 | 5,40 |
| Costo fijo por eSIM activa al mes | 0,80 | 0,80 |
| **Margen** | **1,62 (37 %)** | **5,80 (48 %)** |

El precio de 4,00 USDC/GB es el de la demo y sirve de referencia. El costo cambia mucho según el país, por eso el contrato lleva un precio por país. La tabla no incluye la comisión de la rampa en bolivianos ni costos fijos de plataforma.

## Rampa bolivianos ↔ USDC y custodia

- **Hoy (demo):** la recarga y el retiro se simulan. El USDC es un token de prueba emitido por nosotros.
- **Plan:** la entrada y salida de bolivianos la hace un proveedor de pagos regulado en Bolivia, integrado como *anchor* con los estándares de Stellar: SEP-10 para autenticar la cuenta, SEP-24 para el depósito y retiro interactivo (QR bancario y transferencia a cuenta) y SEP-6 para el flujo automático desde la app. El saldo se mantiene en USDC de Circle sobre Stellar.
- **Custodia:** en la demo y en el piloto la llave vive en el dispositivo del usuario (cuenta clásica de Stellar). El contrato nunca custodia fondos: solo puede mover hasta el tope que el usuario firmó, y el usuario puede revocarlo. Para usuarios que no quieren manejar llaves evaluamos un custodio registrado; en ese caso el tope de gasto sigue siendo el control del usuario sobre cuánto se le puede cobrar.
- **Mainnet:** redesplegar el contrato con precios reales por país, usar el USDC de Circle, y abrir un piloto cerrado con clientes actuales.

## Equipo e historial del repositorio

El desarrollo se hizo en el repositorio privado de Fonnazo, que contiene el backend y la app en producción. Por seguridad ese repositorio no puede ser público, así que este es una copia limpia publicada para la hackathon, con el contrato y la demo. Por eso el historial empieza el último día y todos los commits salen de una sola cuenta.

Lo que sí se puede verificar desde afuera es la fecha del trabajo: el contrato del piloto se desplegó en testnet el 16 de noviembre de 2026 (UTC) y sus cobros con la eSIM real son del 16 y 17 de noviembre, seis días antes de publicar este repositorio.

- **Sebastian Morales:** producto, frontend y pitch. Publicó este repositorio.
- **Camila:** backend e IA, en el repositorio privado: el servicio que lee el consumo de la eSIM y llama a `charge`.

## Licencia

MIT. Ver [LICENSE](LICENSE).

## Qué sigue

- Una billetera Fonnazo dentro de la app, con un custodio registrado, para que el usuario no maneje llaves.
- Recarga y retiro en bolivianos con un proveedor regulado.
- Un piloto con clientes actuales, todavía en testnet.
