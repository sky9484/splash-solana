/// DeepBook execution guard for CUSTODIAL settlement.
///
/// Lives in splash_custody, not splash_core, and deliberately so. This guard
/// exists to protect POOLED funds — it proves a settlement amount can clear
/// inside the configured depth and price-impact limits before money leaves the
/// shared `SettlementPool`. Pools only exist in this package, so in Phase 0
/// (non-custodial, splash_core only) there is nothing for it to guard: a
/// `confirm_payment_intent` moves the caller's own coin in and straight out.
///
/// Keeping it in core would also have forced the mainnet package to carry a
/// DeepBook dependency it does not need.
///
/// Audit context: S-09 warns this guard measures a book the settlement never
/// trades against, so it is a sanity check on market conditions, not proof of
/// execution. S-12 is what makes it meaningful at all — without the venue
/// whitelist it measured a pool the CALLER chose.
module splash_custody::liquidity_guard;

use splash_core::compliance_config::{Self, ComplianceConfig};
use deepbook::pool::Pool;
use openzeppelin_math::rounding;
use openzeppelin_math::u64 as oz_u64;
use sui::clock::Clock;

const E_INSUFFICIENT_DEPTH:   u64 = 304;
const E_SLIPPAGE_EXCEEDED:    u64 = 305;
const E_INVALID_MARKET_PRICE: u64 = 306;

const BPS_DENOMINATOR: u64 = 10_000;
/// Minimum fraction of the requested size DeepBook must be able to fill, in
/// bps. 90% leaves headroom for lot-size dust and the input-side taker fee
/// while still rejecting a book that cannot absorb the settlement.
const MIN_FILL_BPS: u64 = 9_000;
/// Matches DeepBook's own `FLOAT_SCALING` (deepbook::math). Verified against the
/// pinned dependency source — a wrong constant here is the Cetus failure mode.
const DEEPBOOK_PRICE_SCALING: u64 = 1_000_000_000;

/// Independent execution guard. Pyth establishes stablecoin peg truth above;
/// DeepBook only proves that this exact settlement amount can clear inside the
/// configured depth and price-impact limits.
public fun assert_deepbook_liquidity<BaseAsset, QuoteAsset>(
    config: &ComplianceConfig,
    pool: &Pool<BaseAsset, QuoteAsset>,
    base_quantity: u64,
    clock: &Clock,
) {
    // S-12 fix, FIRST — before a single field is read off `pool`. DeepBook pools
    // are permissionlessly creatable, so without this the guard measures a venue
    // the CALLER chose: stand up a pool, seed it with your own liquidity, and
    // the depth and slippage asserts below are satisfied trivially. That turns
    // the whole guard into theatre on the `settle_batch` path, which pays out of
    // the shared SettlementPool. Only venues the protocol whitelisted count.
    compliance_config::assert_pool_allowed(config, object::id(pool));

    let (remaining_base, quote_out, _) = pool.get_quote_quantity_out_input_fee(base_quantity, clock);
    assert!(quote_out > 0, E_INSUFFICIENT_DEPTH);

    // S-11 fix. The previous form was `remaining_base == 0`, which no real
    // DeepBook pool can satisfy: books are lot-quantized (SUI/DBUSDC uses a 0.1
    // lot) and the input-fee quote path deducts the taker fee from the input,
    // so a sub-lot remainder is ALWAYS returned. Measured on testnet, every
    // size from 1.1 to 5.0 SUI came back with ~0.098 unfilled — meaning this
    // assert rejected 100% of batches regardless of liquidity. Require a
    // substantially-complete fill instead of a perfect one.
    assert!(remaining_base < base_quantity, E_INSUFFICIENT_DEPTH);
    let filled_base = base_quantity - remaining_base;
    assert!(
        mul_div_down(filled_base, BPS_DENOMINATOR, base_quantity) >= MIN_FILL_BPS,
        E_INSUFFICIENT_DEPTH,
    );

    let mid_price = pool.mid_price(clock);
    assert!(mid_price > 0, E_INVALID_MARKET_PRICE);
    // S-11 fix. Price the FILLED base, not the requested base. Dividing by the
    // requested quantity charges the unfilled remainder as if it had executed
    // at zero, understating the execution price and overstating slippage by the
    // unfilled fraction — on testnet that turned a real 56 bps into a reported
    // 809 bps and tripped E_SLIPPAGE_EXCEEDED on a perfectly healthy book.
    let effective_price = mul_div_down(quote_out, DEEPBOOK_PRICE_SCALING, filled_base);
    let slippage_bps = if (effective_price >= mid_price) {
        0
    } else {
        mul_div_down(mid_price - effective_price, BPS_DENOMINATOR, mid_price)
    };
    assert!(slippage_bps <= compliance_config::max_slippage_bps(config), E_SLIPPAGE_EXCEEDED);

    let price_floor = mul_div_down(
        mid_price,
        BPS_DENOMINATOR - compliance_config::max_slippage_bps(config),
        BPS_DENOMINATOR,
    );
    let (_, quantities) = pool.get_level2_range(price_floor, mid_price, true, clock);
    let depth = quantities.fold!(0, |sum, quantity| sum + quantity);
    assert!(depth >= compliance_config::min_depth_base_units(config), E_INSUFFICIENT_DEPTH);
    assert!(depth >= base_quantity, E_INSUFFICIENT_DEPTH);
}


fun mul_div_down(a: u64, b: u64, denominator: u64): u64 {
    oz_u64::mul_div(a, b, denominator, rounding::down()).destroy_some()
}
