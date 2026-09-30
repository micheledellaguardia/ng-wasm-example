use std::hint::black_box;

use num_bigint::BigUint;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Factorial (recursive, arbitrary precision)
// ---------------------------------------------------------------------------

pub fn factorial(num: u64) -> BigUint {
    match num {
        0 => BigUint::from(1u32),
        _ => factorial(num - 1) * num,
    }
}

#[wasm_bindgen]
pub fn get_factorial(num: u8) -> String {
    let mut f = BigUint::from(0u32);
    for _ in 0..10000000 {
        f = black_box(factorial(black_box(num) as u64));
    }
    f.to_string()
}

// ---------------------------------------------------------------------------
// Fibonacci (naive recursion, worst-case exponential time)
// ---------------------------------------------------------------------------

fn fibonacci(n: u32) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

#[wasm_bindgen]
pub fn get_fibonacci(n: u32) -> String {
    fibonacci(black_box(n)).to_string()
}

// ---------------------------------------------------------------------------
// Prime counting (Sieve of Eratosthenes)
// ---------------------------------------------------------------------------

fn count_primes(limit: u32) -> u32 {
    if limit < 2 {
        return 0;
    }

    let mut is_prime = vec![true; (limit + 1) as usize];
    is_prime[0] = false;
    is_prime[1] = false;

    let mut i: u64 = 2;
    while i * i <= limit as u64 {
        if is_prime[i as usize] {
            let mut j = i * i;
            while j <= limit as u64 {
                is_prime[j as usize] = false;
                j += i;
            }
        }
        i += 1;
    }

    is_prime.into_iter().filter(|&p| p).count() as u32
}

#[wasm_bindgen]
pub fn get_prime_count(limit: u32) -> u32 {
    count_primes(black_box(limit))
}

// ---------------------------------------------------------------------------
// Mandelbrot set (sum of escape-time iterations over a size x size grid)
// ---------------------------------------------------------------------------

fn mandelbrot_sum(size: u32) -> u64 {
    const MAX_ITER: u32 = 200;
    let size_f = size as f64;
    let mut total: u64 = 0;

    for py in 0..size {
        let y0 = (py as f64 / size_f) * 2.5 - 1.25;
        for px in 0..size {
            let x0 = (px as f64 / size_f) * 3.5 - 2.5;

            let mut x = 0.0f64;
            let mut y = 0.0f64;
            let mut iter = 0u32;

            while x * x + y * y <= 4.0 && iter < MAX_ITER {
                let x_temp = x * x - y * y + x0;
                y = 2.0 * x * y + y0;
                x = x_temp;
                iter += 1;
            }

            total += iter as u64;
        }
    }

    total
}

#[wasm_bindgen]
pub fn get_mandelbrot_sum(size: u32) -> String {
    mandelbrot_sum(black_box(size)).to_string()
}

// ---------------------------------------------------------------------------
// Sorting (xorshift32-seeded array, sorted with the standard unstable sort)
// ---------------------------------------------------------------------------

fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

fn sort_checksum(n: u32) -> String {
    let mut state: u32 = 2463534242;
    let mut arr: Vec<u32> = (0..n).map(|_| xorshift32(&mut state) % 1_000_000).collect();
    arr.sort_unstable();

    let last = (n.max(1) - 1) as usize;
    format!("min={}, median={}, max={}", arr[0], arr[last / 2], arr[last])
}

#[wasm_bindgen]
pub fn get_sort_checksum(n: u32) -> String {
    sort_checksum(black_box(n))
}

// ---------------------------------------------------------------------------
// Image filter (grayscale + 3x3 box blur over a synthetic RGBA buffer)
//
// Real-world analogue: client-side image editing / thumbnailing (see e.g.
// Squoosh), operating on large byte buffers with no floating point involved
// so JS and Rust produce bit-identical output.
// ---------------------------------------------------------------------------

fn generate_image(size: u32) -> Vec<u8> {
    let mut state: u32 = 2463534242;
    let len = (size as usize) * (size as usize) * 4;
    (0..len).map(|_| (xorshift32(&mut state) & 0xff) as u8).collect()
}

fn grayscale_and_blur(size: u32) -> u64 {
    let buf = generate_image(size);
    let w = size as usize;
    let h = size as usize;

    let mut gray = vec![0u8; w * h];
    for i in 0..w * h {
        let r = buf[i * 4] as u32;
        let g = buf[i * 4 + 1] as u32;
        let b = buf[i * 4 + 2] as u32;
        gray[i] = ((77 * r + 150 * g + 29 * b) >> 8) as u8;
    }

    let mut blurred = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut sum: u32 = 0;
            for dy in -1i32..=1 {
                let ny = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                for dx in -1i32..=1 {
                    let nx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    sum += gray[ny * w + nx] as u32;
                }
            }
            blurred[y * w + x] = (sum / 9) as u8;
        }
    }

    blurred.into_iter().map(|v| v as u64).sum()
}

#[wasm_bindgen]
pub fn get_image_checksum(size: u32) -> String {
    grayscale_and_blur(black_box(size)).to_string()
}

// ---------------------------------------------------------------------------
// Hashing (FNV-1a 32-bit over a synthetic byte buffer)
//
// Real-world analogue: content hashing / checksums for caching, dedup and
// client-side integrity checks.
// ---------------------------------------------------------------------------

fn fnv1a(size: u32) -> u32 {
    const OFFSET_BASIS: u32 = 0x811c_9dc5;
    const PRIME: u32 = 0x0100_0193;

    let mut state: u32 = 2463534242;
    let mut hash: u32 = OFFSET_BASIS;

    for _ in 0..size {
        let byte = (xorshift32(&mut state) & 0xff) as u32;
        hash ^= byte;
        hash = hash.wrapping_mul(PRIME);
    }

    hash
}

#[wasm_bindgen]
pub fn get_buffer_hash(size: u32) -> String {
    format!("{:08x}", fnv1a(black_box(size)))
}

// ---------------------------------------------------------------------------
// JSON parsing (counter-example: crossing the JS <-> WASM string boundary)
//
// The JSON text is generated once in JS and handed to Rust as a plain
// string, so this benchmark isolates *parsing* cost (plus the UTF-8
// marshaling wasm-bindgen performs) rather than generation cost. Native
// `JSON.parse` is a heavily optimized browser primitive, so this is a case
// where WASM does not automatically win.
// ---------------------------------------------------------------------------

fn json_sum(json: &str) -> f64 {
    let values: Vec<f64> = serde_json::from_str(json).expect("valid JSON number array");
    values.iter().sum()
}

#[wasm_bindgen]
pub fn get_json_sum(json: &str) -> String {
    format!("{:.2}", json_sum(black_box(json)))
}

// ---------------------------------------------------------------------------
// Substring search (hand-rolled byte scan over a synthetic text buffer)
//
// Real-world analogue: custom parsers, tokenizers, sanitizers or template
// engines that scan text themselves instead of delegating to a built-in,
// engine-optimized string method (`String.prototype.indexOf`, etc.).
// ---------------------------------------------------------------------------

fn generate_text(len: u32) -> Vec<u8> {
    let mut state: u32 = 2463534242;
    (0..len).map(|_| b'a' + (xorshift32(&mut state) % 26) as u8).collect()
}

fn count_pattern(len: u32) -> u32 {
    let text = generate_text(len);
    let pattern = b"wasm";
    let mut count = 0u32;

    if text.len() >= pattern.len() {
        for i in 0..=(text.len() - pattern.len()) {
            if text[i..i + pattern.len()] == *pattern {
                count += 1;
            }
        }
    }

    count
}

#[wasm_bindgen]
pub fn get_pattern_count(len: u32) -> u32 {
    count_pattern(black_box(len))
}
