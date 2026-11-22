//! Medidor de pago por uso de Fonnazo.
//!
//! El usuario tiene el token (USDC) en SU cuenta y firma una sola vez un
//! permiso de gasto (`approve`) a favor de este contrato. Cada vez que el
//! proveedor de la eSIM reporta consumo, el comercio llama a `charge` con el
//! ACUMULADO de bytes consumidos en un país; el contrato calcula cuánto falta
//! cobrar y lo mueve con `transfer_from` del usuario al comercio.
//!
//! Garantías para el usuario:
//! - El precio por GB de cada país queda grabado al desplegar. No hay función
//!   para cambiarlo ni administrador: una tabla nueva exige un contrato nuevo
//!   y un permiso nuevo del usuario.
//! - El tope y el vencimiento del permiso los impone el token, no este contrato.
//! - Se cobra sobre el acumulado, así que repetir una llamada no cobra dos veces.
//!
//! Unidades: precio = unidades base del token por 1.000.000.000 bytes (1 GB
//! decimal). Costo total = floor(bytes_acumulados × precio / 1e9).
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env, Symbol, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
// La instancia (comercio y token) se renueva en cada cobro.
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
// Precios y acumulados: 120 días, renovados cuando les quedan menos de 113.
const ENTRY_BUMP: u32 = 120 * DAY_IN_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - 7 * DAY_IN_LEDGERS;

const BYTES_PER_GB: i128 = 1_000_000_000;
/// Tarifa "resto del mundo": aplica a los países sin precio propio.
const DEFAULT_COUNTRY: Symbol = symbol_short!("ZZ");

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Merchant,
    Token,
    /// Precio por GB de un país (ISO2 en mayúsculas).
    Price(Symbol),
    /// Bytes acumulados ya cobrados a (usuario, país).
    Consumed(Address, Symbol),
    /// Monto ya cobrado a (usuario, país), en unidades base.
    Charged(Address, Symbol),
    /// Monto total cobrado al usuario, en unidades base.
    Total(Address),
}

// Códigos del 1 al 5 a propósito: el contrato del token usa 9 (permiso) y 10
// (saldo), y el backend distingue "falta de fondos" por esos códigos.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// El país no tiene precio y falta la tarifa por defecto.
    PriceMissing = 1,
    /// El acumulado informado es menor al ya cobrado.
    BytesWentBack = 2,
    Overflow = 3,
    /// Precio menor o igual a cero en el constructor.
    InvalidPrice = 4,
    /// La tabla del constructor no trae la tarifa por defecto ("ZZ").
    DefaultPriceMissing = 5,
}

/// Un cobro. Tópicos: ["charge", user]. Datos: mapa con los demás campos.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Charge {
    #[topic]
    pub user: Address,
    pub country: Symbol,
    pub delta_bytes: u64,
    pub cumulative_bytes: u64,
    pub amount: i128,
}

#[contract]
pub struct Medidor;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

fn bump_entry(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, ENTRY_THRESHOLD, ENTRY_BUMP);
}

/// Precio del país o, si no tiene, la tarifa por defecto.
fn read_price(env: &Env, country: &Symbol) -> Result<i128, Error> {
    let own = DataKey::Price(country.clone());
    if let Some(price) = env.storage().persistent().get::<DataKey, i128>(&own) {
        bump_entry(env, &own);
        return Ok(price);
    }
    let fallback = DataKey::Price(DEFAULT_COUNTRY);
    match env.storage().persistent().get::<DataKey, i128>(&fallback) {
        Some(price) => {
            bump_entry(env, &fallback);
            Ok(price)
        }
        None => Err(Error::PriceMissing),
    }
}

#[contractimpl]
impl Medidor {
    /// `merchant`: cuenta que puede cobrar y que recibe los cobros.
    /// `token`: contrato del token (SEP-41) en el que se cobra.
    /// `prices`: pares (país ISO2, precio por GB en unidades base). Debe incluir "ZZ".
    pub fn __constructor(env: Env, merchant: Address, token: Address, prices: Vec<(Symbol, i128)>) {
        env.storage().instance().set(&DataKey::Merchant, &merchant);
        env.storage().instance().set(&DataKey::Token, &token);
        let mut has_default = false;
        for (country, price) in prices.iter() {
            if price <= 0 {
                panic_with_error!(&env, Error::InvalidPrice);
            }
            if country == DEFAULT_COUNTRY {
                has_default = true;
            }
            let key = DataKey::Price(country);
            env.storage().persistent().set(&key, &price);
            bump_entry(&env, &key);
        }
        if !has_default {
            panic_with_error!(&env, Error::DefaultPriceMissing);
        }
        bump_instance(&env);
    }

    /// Cobra a `user` lo que falte para cubrir `cumulative_bytes` consumidos en
    /// `country`. Solo el comercio puede llamarla. Devuelve el monto cobrado.
    /// Si el permiso o el saldo del usuario no alcanzan, falla entera y no cambia nada.
    pub fn charge(env: Env, user: Address, country: Symbol, cumulative_bytes: u64) -> Result<i128, Error> {
        let merchant: Address = env.storage().instance().get(&DataKey::Merchant).unwrap();
        merchant.require_auth();
        bump_instance(&env);

        let price = read_price(&env, &country)?;
        let consumed_key = DataKey::Consumed(user.clone(), country.clone());
        let charged_key = DataKey::Charged(user.clone(), country.clone());
        let consumed: u64 = env.storage().persistent().get(&consumed_key).unwrap_or(0);
        if cumulative_bytes < consumed {
            return Err(Error::BytesWentBack);
        }
        let charged: i128 = env.storage().persistent().get(&charged_key).unwrap_or(0);

        // Sobre el acumulado, no sobre el tramo: así el redondeo no se suma.
        let due = (cumulative_bytes as i128)
            .checked_mul(price)
            .ok_or(Error::Overflow)?
            / BYTES_PER_GB;
        let amount = due.checked_sub(charged).ok_or(Error::Overflow)?;

        if amount > 0 {
            let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            // El contrato es el `spender` del permiso y llama directo al token.
            token::TokenClient::new(&env, &token_address).transfer_from(
                &env.current_contract_address(),
                &user,
                &merchant,
                &amount,
            );
            env.storage().persistent().set(&charged_key, &due);
            let total_key = DataKey::Total(user.clone());
            let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
            let new_total = total.checked_add(amount).ok_or(Error::Overflow)?;
            env.storage().persistent().set(&total_key, &new_total);
            bump_entry(&env, &charged_key);
            bump_entry(&env, &total_key);
        }

        if cumulative_bytes > consumed {
            env.storage().persistent().set(&consumed_key, &cumulative_bytes);
            bump_entry(&env, &consumed_key);
            Charge {
                user,
                country,
                delta_bytes: cumulative_bytes - consumed,
                cumulative_bytes,
                amount,
            }
            .publish(&env);
        }
        Ok(amount)
    }

    /// Precio por GB que aplica a un país (el propio o la tarifa por defecto).
    pub fn price(env: Env, country: Symbol) -> Result<i128, Error> {
        read_price(&env, &country)
    }

    /// Bytes acumulados ya cobrados a (usuario, país).
    pub fn consumed(env: Env, user: Address, country: Symbol) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Consumed(user, country))
            .unwrap_or(0)
    }

    /// Monto ya cobrado a (usuario, país), en unidades base.
    pub fn charged(env: Env, user: Address, country: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Charged(user, country))
            .unwrap_or(0)
    }

    /// Monto total cobrado al usuario en todos los países.
    pub fn total_charged(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Total(user))
            .unwrap_or(0)
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn merchant(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Merchant).unwrap()
    }
}

mod test;
