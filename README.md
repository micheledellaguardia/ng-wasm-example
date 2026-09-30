# NgWasmExample

Progetto dimostrativo che integra **Angular** e **Rust compilato in
WebAssembly** nella stessa applicazione, ispirato a
[questo articolo](https://medium.com/@eugeniyoz/powering-angular-with-rust-wasm-0eed1668a51c).

Il cuore del progetto è una pagina di benchmark che esegue **lo stesso
identico algoritmo** una volta in JavaScript e una volta in Rust/WASM
(fattoriale, Fibonacci, crivello di Eratostene, insieme di Mandelbrot,
ordinamento array, filtro immagine, hashing, parsing JSON, ricerca di
sottostringa), misura i tempi di esecuzione, calcola statistiche descrittive
e un test di significatività (t di Welch), e riepiloga tutto in grafici e in
una tabella esportabile in CSV.

## Struttura del workspace

Workspace Angular multi-progetto:

- **`projects/example-app`** — applicazione Angular standalone che ospita la
  pagina di benchmark (`src/app/app.ts` / `app.html` / `app.css`).
- **`projects/wasm-example`** — libreria Angular (`public-api.ts`) che
  ri-esporta le funzioni generate da `wasm-bindgen`, e al suo interno:
  - **`src/lib/example-rust-lib`** — il crate Rust (`lib.rs`) compilato in
    WebAssembly con `wasm-pack`; l'output finisce in
    `src/lib/example-rust-lib/pkg/`, che è già sotto controllo di versione
    (va **rigenerato** dopo ogni modifica a `lib.rs`, vedi sotto).

## Prerequisiti

- [Node.js](https://nodejs.org/) 20+ e npm
- [Angular CLI](https://angular.dev/tools/cli) (incluso come dev dependency,
  invocabile con `npx ng ...`)
- [Rust](https://www.rust-lang.org/tools/install) (toolchain stabile) con il
  target `wasm32-unknown-unknown`
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

```bash
# toolchain Rust + target wasm
rustup target add wasm32-unknown-unknown

# wasm-pack (build tool che genera i binding JS/TS da wasm-bindgen)
cargo install wasm-pack
# oppure: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

Versioni usate in sviluppo: `rustc 1.93`, `wasm-pack 0.15`.

## Setup iniziale

```bash
npm install
```

## Compilare la parte Rust/WASM

Il pacchetto WASM **non** viene ricompilato automaticamente da `ng build`/`ng
serve`: va rigenerato manualmente ogni volta che si modifica
`projects/wasm-example/src/lib/example-rust-lib/src/lib.rs`.

```bash
cd projects/wasm-example/src/lib/example-rust-lib
wasm-pack build --target web --release
```

Questo rigenera `pkg/` (binding `.js`/`.d.ts` + binario `.wasm`), che
`projects/wasm-example/src/public-api.ts` importa ed espone alla libreria
Angular. Se aggiungi una nuova funzione `#[wasm_bindgen]` in `lib.rs`,
ricordati di esportarla anche da `public-api.ts`.

## Eseguire l'app in sviluppo

```bash
npx ng serve example-app
```

Apri `http://localhost:4200/`. L'app si ricarica automaticamente ai
cambiamenti dei sorgenti TypeScript/HTML/CSS — **non** a quelli di `lib.rs`
(richiedono una nuova `wasm-pack build`, seguita da un refresh del browser).

## Build di produzione

```bash
npx ng build example-app
```

Artefatti generati in `dist/example-app/`.

## Test

```bash
npx ng test
```

Esegue i test unitari con [Vitest](https://vitest.dev/).

## Flusso di lavoro tipico per modificare un benchmark

1. Aggiungi/modifica la funzione in
   `projects/wasm-example/src/lib/example-rust-lib/src/lib.rs`.
2. `wasm-pack build --target web --release` (vedi sopra).
3. Esporta la nuova funzione da
   `projects/wasm-example/src/public-api.ts`.
4. Aggiungi l'implementazione JS "gemella" e il relativo `BenchmarkRunner` in
   `projects/example-app/src/app/app.ts` (le due implementazioni devono
   produrre risultati identici, non solo tempi comparabili).
5. `npx ng serve example-app` e verifica nella pagina.

## Risorse aggiuntive

- [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)
- [wasm-bindgen guide](https://rustwasm.github.io/docs/wasm-bindgen/)
- [wasm-pack](https://rustwasm.github.io/docs/wasm-pack/)
