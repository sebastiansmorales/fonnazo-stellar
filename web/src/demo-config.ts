// Configuración de la DEMO pública (Stellar TESTNET). Generado desde deploy/.env.payg.local.
// Las llaves de abajo son de cuentas de demostración en testnet, sin valor y separadas del piloto real:
// van a la vista a propósito para que la página firme sus propias transacciones sin backend.
export const DEMO = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  friendbot: 'https://friendbot.stellar.org',
  explorer: 'https://stellar.expert/explorer/testnet',
  meterContractId: 'CCDP3AAQY7F2BDCHQCTOW43ZZUJDABOOKTY7BBV5AVVWRXQVSA7FZFXI',
  tokenContractId: 'CC56NINYVIQAIGLNBBHYHWEWZCUJXE6CZWKEZIPBU7UD2SGZWZGLE74V',
  tokenCode: 'USDC',
  tokenIssuer: 'GATKN3JDRI3BYS6OWQHZL3IJRVY7V4CFJ2WVCNOW3D4XVKAWK54FNPUA',
  pricePerGb: 4,
  country: 'BR',
  merchantSecret: 'SCWGSHT6O6GKJMI7T4ED2KOXIDS7SXZBMJH64AICH333PLKNK5RGANBQ',
  topupSecret: 'SAZ6X5A65AACAK2GGY4M3AZ7NY5CQBR3XF4UWV6NH5EKUD2RJCSDMBGW',
} as const
