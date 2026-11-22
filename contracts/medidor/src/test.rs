#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, Event,
};

// 1,50 por GB en Bolivia, 2,20 en Brasil, 6,00 resto del mundo (7 decimales).
const BO: i128 = 15_000_000;
const BR: i128 = 22_000_000;
const ZZ: i128 = 60_000_000;

struct Setup<'a> {
    env: Env,
    contract_id: Address,
    client: MedidorClient<'a>,
    token: TokenClient<'a>,
    merchant: Address,
    user: Address,
}

/// Despliega token + medidor, le da `balance` al usuario y `allowance` de permiso al contrato.
fn setup<'a>(balance: i128, allowance: i128) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let user = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = TokenClient::new(&env, &sac.address());
    StellarAssetClient::new(&env, &sac.address()).mint(&user, &balance);

    let prices = vec![
        &env,
        (symbol_short!("BO"), BO),
        (symbol_short!("BR"), BR),
        (symbol_short!("ZZ"), ZZ),
    ];
    let contract_id = env.register(
        Medidor,
        MedidorArgs::__constructor(&merchant, &sac.address(), &prices),
    );
    let client = MedidorClient::new(&env, &contract_id);

    if allowance > 0 {
        token.approve(&user, &contract_id, &allowance, &1000);
    }

    Setup { env, contract_id, client, token, merchant, user }
}

#[test]
fn cobra_el_tramo_y_registra_el_acumulado() {
    let s = setup(100_000_000, 50_000_000);
    let bo = symbol_short!("BO");

    // 16 MB a 1,50/GB = 0,024.
    assert_eq!(s.client.charge(&s.user, &bo, &16_000_000), 240_000);
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract_id),
        [Charge {
            user: s.user.clone(),
            country: bo.clone(),
            delta_bytes: 16_000_000,
            cumulative_bytes: 16_000_000,
            amount: 240_000,
        }
        .to_xdr(&s.env, &s.contract_id)]
    );

    assert_eq!(s.token.balance(&s.user), 100_000_000 - 240_000);
    assert_eq!(s.token.balance(&s.merchant), 240_000);
    assert_eq!(s.token.allowance(&s.user, &s.contract_id), 50_000_000 - 240_000);
    assert_eq!(s.client.consumed(&s.user, &bo), 16_000_000);
    assert_eq!(s.client.charged(&s.user, &bo), 240_000);
    assert_eq!(s.client.total_charged(&s.user), 240_000);
}

#[test]
fn repetir_el_mismo_acumulado_no_cobra_de_nuevo() {
    let s = setup(100_000_000, 50_000_000);
    let bo = symbol_short!("BO");
    assert_eq!(s.client.charge(&s.user, &bo, &16_000_000), 240_000);
    assert_eq!(s.client.charge(&s.user, &bo, &16_000_000), 0);
    assert_eq!(s.token.balance(&s.merchant), 240_000);
    assert_eq!(s.client.total_charged(&s.user), 240_000);
}

#[test]
fn el_redondeo_se_hace_sobre_el_acumulado() {
    let s = setup(100_000_000, 50_000_000);
    let bo = symbol_short!("BO");
    // Por tramo serían 4999 × 3 = 14997; sobre el acumulado (999.999 bytes) son 14999.
    assert_eq!(s.client.charge(&s.user, &bo, &333_333), 4_999);
    assert_eq!(s.client.charge(&s.user, &bo, &666_666), 5_000);
    assert_eq!(s.client.charge(&s.user, &bo, &999_999), 5_000);
    assert_eq!(s.client.charged(&s.user, &bo), 14_999);
    assert_eq!(s.token.balance(&s.merchant), 14_999);
}

#[test]
fn cada_pais_lleva_su_propio_acumulado_y_precio() {
    let s = setup(1_000_000_000, 1_000_000_000);
    let bo = symbol_short!("BO");
    let br = symbol_short!("BR");
    assert_eq!(s.client.charge(&s.user, &bo, &1_000_000_000), BO);
    assert_eq!(s.client.charge(&s.user, &br, &1_000_000_000), BR);
    assert_eq!(s.client.consumed(&s.user, &bo), 1_000_000_000);
    assert_eq!(s.client.consumed(&s.user, &br), 1_000_000_000);
    assert_eq!(s.client.total_charged(&s.user), BO + BR);
}

#[test]
fn un_pais_sin_precio_usa_la_tarifa_por_defecto() {
    let s = setup(1_000_000_000, 1_000_000_000);
    let jp = symbol_short!("JP");
    assert_eq!(s.client.price(&jp), ZZ);
    assert_eq!(s.client.price(&symbol_short!("BO")), BO);
    assert_eq!(s.client.charge(&s.user, &jp, &1_000_000_000), ZZ);
}

#[test]
fn un_acumulado_que_retrocede_falla() {
    let s = setup(100_000_000, 50_000_000);
    let bo = symbol_short!("BO");
    s.client.charge(&s.user, &bo, &16_000_000);
    assert_eq!(
        s.client.try_charge(&s.user, &bo, &15_999_999),
        Err(Ok(Error::BytesWentBack))
    );
    assert_eq!(s.client.consumed(&s.user, &bo), 16_000_000);
}

#[test]
fn sin_permiso_suficiente_falla_entera_y_no_cambia_nada() {
    // Saldo de sobra, pero el permiso solo cubre 0,01 y el cobro es 0,024.
    let s = setup(100_000_000, 100_000);
    let bo = symbol_short!("BO");
    assert!(s.client.try_charge(&s.user, &bo, &16_000_000).is_err());
    assert_eq!(s.token.balance(&s.user), 100_000_000);
    assert_eq!(s.token.balance(&s.merchant), 0);
    assert_eq!(s.token.allowance(&s.user, &s.contract_id), 100_000);
    assert_eq!(s.client.consumed(&s.user, &bo), 0);
    assert_eq!(s.client.charged(&s.user, &bo), 0);
    assert_eq!(s.client.total_charged(&s.user), 0);
}

#[test]
fn sin_saldo_suficiente_falla_entera_y_no_cambia_nada() {
    // Permiso de sobra, pero el saldo es 0,01 y el cobro es 0,024.
    let s = setup(100_000, 50_000_000);
    let bo = symbol_short!("BO");
    assert!(s.client.try_charge(&s.user, &bo, &16_000_000).is_err());
    assert_eq!(s.token.balance(&s.user), 100_000);
    assert_eq!(s.token.balance(&s.merchant), 0);
    assert_eq!(s.client.consumed(&s.user, &bo), 0);
}

#[test]
fn sin_permiso_no_se_puede_cobrar() {
    let s = setup(100_000_000, 0);
    assert!(s
        .client
        .try_charge(&s.user, &symbol_short!("BO"), &16_000_000)
        .is_err());
    assert_eq!(s.token.balance(&s.user), 100_000_000);
}

#[test]
fn solo_el_comercio_autoriza_el_cobro() {
    let s = setup(100_000_000, 50_000_000);
    let bo = symbol_short!("BO");
    s.client.charge(&s.user, &bo, &16_000_000);
    // La única autorización exigida en la raíz de la llamada es la del comercio.
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.merchant);
}

#[test]
fn expone_token_y_comercio() {
    let s = setup(1, 0);
    assert_eq!(s.client.token(), s.token.address);
    assert_eq!(s.client.merchant(), s.merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn el_constructor_exige_la_tarifa_por_defecto() {
    let env = Env::default();
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    env.register(
        Medidor,
        MedidorArgs::__constructor(&merchant, &token, &vec![&env, (symbol_short!("BO"), BO)]),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn el_constructor_rechaza_precios_no_positivos() {
    let env = Env::default();
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    env.register(
        Medidor,
        MedidorArgs::__constructor(
            &merchant,
            &token,
            &vec![&env, (symbol_short!("BO"), 0), (symbol_short!("ZZ"), ZZ)],
        ),
    );
}
