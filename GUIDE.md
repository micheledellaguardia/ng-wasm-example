# WebAssembly (Rust) in Angular — guida pratica

> Mini-corso passo-passo: perché, quando e come integrare un modulo
> WebAssembly scritto in Rust dentro un'applicazione Angular, per
> sostituire una funzione di calcolo scritta in JavaScript.
>
> Livello: sviluppatori Angular con basi di TypeScript. Non serve
> conoscere Rust in anticipo — ogni riga di codice Rust è spiegata.

## Indice

1. [Cos'è WebAssembly, in due parole](#1-cosè-webassembly-in-due-parole)
2. [Perché Rust (e non C++/AssemblyScript/altro)](#2-perché-rust-e-non-c-assemblyscriptaltro)
3. [Quando ha senso usare WASM — e quando NO](#3-quando-ha-senso-usare-wasm--e-quando-no)
4. [Come funziona il confine JS ↔ WASM](#4-come-funziona-il-confine-js--wasm)
5. [Prerequisiti e installazione strumenti](#5-prerequisiti-e-installazione-strumenti)
6. [Passo 1 — Creare il progetto Angular da zero](#6-passo-1--creare-il-progetto-angular-da-zero)
7. [Passo 2 — Creare il crate Rust](#7-passo-2--creare-il-crate-rust)
8. [Passo 3 — Scrivere la prima funzione: ordinamento array](#8-passo-3--scrivere-la-prima-funzione-ordinamento-array)
9. [Passo 4 — Compilare in WebAssembly con wasm-pack](#9-passo-4--compilare-in-webassembly-con-wasm-pack)
10. [Passo 5 — Collegare il pacchetto WASM ad Angular](#10-passo-5--collegare-il-pacchetto-wasm-ad-angular)
11. [Passo 6 — Chiamare la funzione Rust al posto di quella JS](#11-passo-6--chiamare-la-funzione-rust-al-posto-di-quella-js)
12. [Secondo esempio: verifica di integrità (hash)](#12-secondo-esempio-verifica-di-integrità-hash)
13. [Inizializzazione robusta (evitare race condition)](#13-inizializzazione-robusta-evitare-race-condition)
14. [Organizzare WASM come libreria Angular riutilizzabile](#14-organizzare-wasm-come-libreria-angular-riutilizzabile)
15. [Buone pratiche](#15-buone-pratiche)
16. [Come misurare se ne vale davvero la pena](#16-come-misurare-se-ne-vale-davvero-la-pena)
17. [Checklist decisionale finale](#17-checklist-decisionale-finale)
18. [Errori comuni e come risolverli](#18-errori-comuni-e-come-risolverli)
19. [Risorse ed esempio di riferimento](#19-risorse-ed-esempio-di-riferimento)

---

## 1. Cos'è WebAssembly, in due parole

WebAssembly (**WASM**) è un formato binario a basso livello, eseguibile in
sandbox dal browser (e da Node.js) a una velocità molto vicina a quella del
codice nativo. Non sostituisce JavaScript: **coesiste** con esso. Un modulo
WASM:

- non ha accesso diretto al DOM, al `window`, al `fetch`, ecc. — ci arriva
  solo passando dai binding JS che lo "avvolgono";
- lavora su una propria area di memoria lineare (un grande `ArrayBuffer`);
- espone funzioni che JavaScript può chiamare come fossero funzioni JS
  qualunque, una volta caricato il modulo.

In pratica: **JS resta il "collante" dell'applicazione** (DOM, eventi,
routing, HTTP, reattività Angular); **WASM interviene solo nei calcoli
pesanti**, come un "acceleratore" chiamato da JS quando serve.

## 2. Perché Rust (e non C++/AssemblyScript/altro)

Si può generare WASM da diversi linguaggi (C/C++, Rust, Go, Zig,
AssemblyScript...). Rust è oggi la scelta più comune nel mondo web per
alcuni motivi concreti:

- **Nessun garbage collector**: le prestazioni sono prevedibili, senza
  pause GC — importante per calcoli in tempo reale (audio, grafica, giochi).
- **Tooling maturo e integrato**: `wasm-bindgen` genera automaticamente i
  binding TypeScript/JavaScript a partire dal codice Rust; `wasm-pack`
  orchestra build e packaging con un solo comando.
- **Sicurezza della memoria** a tempo di compilazione (niente
  buffer-overflow/use-after-free), senza pagare il costo di un runtime
  gestito.
- **Ecosistema `crates.io`**: enormi quantità di librerie (compressione,
  crittografia, parsing, elaborazione immagini...) già pronte, spesso
  compilabili in WASM senza modifiche.

Non è un requisito religioso: se il tuo team conosce già bene C++ o AssemblyScript
(sottoinsieme di TypeScript, più semplice da imparare ma meno maturo/performante),
quelle strade restano valide. Questa guida usa Rust perché è l'opzione con il
miglior rapporto maturità/prestazioni/supporto oggi.

## 3. Quando ha senso usare WASM — e quando NO

Questa è la parte più importante da trasmettere al team: **WASM non è "JS ma
più veloce" in generale**. È più veloce (spesso molto) solo per certe classi
di problemi, e ha un costo di complessità che va giustificato.

### ✅ Casi in cui ha senso

| Scenario | Perché WASM aiuta |
|---|---|
| Calcoli numerici/algoritmici pesanti (crittografia, hashing, compressione) | Cicli stretti, CPU-bound, nessuna interazione con il DOM |
| Elaborazione immagini/audio/video lato client (filtri, codec, thumbnail) | Manipolazione intensiva di buffer di byte |
| Parsing/serializzazione di formati binari o testuali custom, non standard | Evita l'overhead di strutture dati JS "generiche" |
| Porting di una libreria C/C++/Rust già esistente e validata (es. un motore fisico, un parser, un codec) | Riuso diretto invece di riscrivere e ri-validare in JS |
| Logica "core" condivisa fra web, mobile, server (stesso crate Rust ovunque) | Un solo algoritmo, meno bug di disallineamento |
| Simulazioni, algoritmi su grandi dataset in memoria (ordinamento, ricerca, grafi) | Accesso a memoria tipizzata senza overhead di boxing |

### ❌ Casi in cui NON conviene (o conviene misurare prima)

| Scenario | Perché NON conviene |
|---|---|
| Manipolazione del DOM, reattività, routing, form | È il mestiere di Angular/JS: WASM non ci accede direttamente, dovrebbe comunque passare da JS — zero vantaggio, solo complessità |
| Operazioni già ottimizzate nativamente dal motore JS (`JSON.parse`, `Array.sort` su piccoli array, regex) | Il motore V8/SpiderMonkey ha anni di ottimizzazione in C++; spesso batte una prima implementazione "ingenua" in Rust, soprattutto se il testo/array attraversa il confine JS↔WASM (vedi §4) |
| Funzioni chiamate raramente o su input piccoli | Il costo (fisso) di marshaling dei dati e di gestione del modulo supera il guadagno |
| Team senza esperienza Rust e senza tempo per formarsi | Un bug di build/toolchain Rust ferma tutto il team frontend; valutare il costo di manutenzione, non solo quello di sviluppo iniziale |
| Serve solo "sembrare moderni" / hype | Ogni riga di codice in più (soprattutto in un linguaggio diverso) è debito tecnico se non risolve un problema reale e misurato |

### La regola pratica

> **Misura prima, ottimizza dopo.** Non introdurre WASM "per principio": scrivi
> prima la versione JS, misurala (`performance.now()`, profiler del browser),
> e introduci WASM solo se il calcolo è realmente un collo di bottiglia *e*
> se un prototipo Rust dimostra un guadagno significativo e stabile (non solo
> su un singolo run: vedi [§16](#16-come-misurare-se-ne-vale-davvero-la-pena)).

Il progetto di esempio allegato a questa guida (cartella `projects/` di
questo repository) è pensato esattamente per questo: una pagina che confronta
side-by-side JS e Rust/WASM su 9 algoritmi diversi, con tanto di test di
significatività statistica — così le decisioni si basano su numeri, non
sensazioni. Vedi [§19](#19-risorse-ed-esempio-di-riferimento).

## 4. Come funziona il confine JS ↔ WASM

Concetto chiave da capire prima di scrivere codice: **passare dati fra
JavaScript e WASM non è gratis**.

- I **numeri** (interi, float) passano "per valore" a costo pressoché nullo:
  sono gli argomenti/ritorni più efficienti da usare.
- Le **stringhe** devono essere copiate: JS usa UTF-16 internamente, WASM
  lavora su byte grezzi in memoria lineare (`wasm-bindgen` le converte in
  UTF-8). Stringhe lunghe o scambiate molto spesso hanno un costo di copia
  non trascurabile.
- Gli **array/buffer di byte** (`Uint8Array`, ecc.) sono il modo più
  efficiente per scambiare grandi quantità di dati: `wasm-bindgen` può
  esporli come viste dirette sulla memoria WASM, evitando copie multiple.
- Gli **oggetti complessi** (classi, JSON annidati) sono il caso più costoso:
  vanno serializzati (es. con `serde_json`) da un lato e deserializzati
  dall'altro.

**Implicazione pratica**: se la tua funzione fa un solo calcolo pesante su un
buffer di numeri e ritorna un numero, il confine costa pochissimo rispetto al
calcolo. Se invece chiami una funzione WASM migliaia di volte al secondo con
piccoli argomenti, o le passi stringhe/oggetti enormi ogni volta, l'overhead
di marshaling può azzerare (o superare) il vantaggio — è esattamente il
contro-esempio "parsing JSON" nel progetto di riferimento.

## 5. Prerequisiti e installazione strumenti

```bash
# 1. Node.js 20+ e npm (già necessari per Angular)
node --version
npm --version

# 2. Rust, via rustup (https://rustup.rs)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version      # verificato con questa guida: rustc 1.93

# 3. Target di compilazione WebAssembly per Rust
rustup target add wasm32-unknown-unknown

# 4. wasm-pack: compila il crate Rust e genera i binding JS/TS
cargo install wasm-pack
wasm-pack --version   # verificato con questa guida: wasm-pack 0.15

# 5. Angular CLI (se non già presente globalmente, si può usare npx)
npm install -g @angular/cli
ng version            # verificato con questa guida: Angular 22
```

> Nota: non serve installare nulla di "browser-specifico". `wasm-pack build
> --target web` genera codice che funziona in qualunque browser moderno e in
> Node ≥ 18 per i test.

## 6. Passo 1 — Creare il progetto Angular da zero

```bash
ng new wasm-demo --style=css --routing=false
cd wasm-demo
```

Angular 22 genera già componenti **standalone** di default (niente
`NgModule`), che è quanto useremo qui.

Verifica che parta:

```bash
ng serve
# apri http://localhost:4200
```

## 7. Passo 2 — Creare il crate Rust

Creiamo la libreria Rust **accanto** al progetto Angular (non dentro
`src/`, per tenere nettamente separati i due mondi):

```bash
cargo new --lib wasm-libs/sort-lib
cd wasm-libs/sort-lib
```

Apri `Cargo.toml` e sostituiscilo con:

```toml
[package]
name = "sort-lib"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]   # <- fondamentale: produce una libreria dinamica
                          #    caricabile, il formato richiesto per WASM

[profile.release]
lto = true                # ottimizzazione link-time: binario più piccolo/veloce

[dependencies]
wasm-bindgen = "0.2"      # genera i binding JS/TS automaticamente
```

Punti chiave:

- `crate-type = ["cdylib"]` dice a Rust di produrre un binario dinamico
  (necessario per WASM), non una libreria Rust "normale" (`rlib`).
- `wasm-bindgen` è **l'unica dipendenza indispensabile**: è il ponte che
  genera automaticamente i file `.js`/`.d.ts` con cui Angular parlerà con il
  tuo codice Rust.

## 8. Passo 3 — Scrivere la prima funzione: ordinamento array

Sostituisci il contenuto di `wasm-libs/sort-lib/src/lib.rs`:

```rust
use wasm_bindgen::prelude::*;

/// Ordina un array di interi a 32 bit e lo restituisce ordinato.
///
/// `#[wasm_bindgen]` è l'annotazione che dice a wasm-bindgen:
/// "esponi questa funzione a JavaScript/TypeScript".
#[wasm_bindgen]
pub fn sort_i32(mut values: Vec<i32>) -> Vec<i32> {
    values.sort_unstable(); // l'algoritmo di sort della standard library
    values
}
```

Spiegazione riga per riga (per chi non conosce Rust):

- `use wasm_bindgen::prelude::*;` importa le macro/tipi necessari.
- `pub fn sort_i32(mut values: Vec<i32>) -> Vec<i32>` è una funzione
  pubblica che prende un vettore di interi **in proprietà** (`mut` perché
  la modifichiamo sul posto) e ne restituisce uno nuovo.
- `wasm-bindgen` sa automaticamente convertire `Vec<i32>` in/da un
  `Int32Array` JavaScript — non serve scrivere codice di conversione a mano.
- `sort_unstable()` è il sort della libreria standard di Rust (quicksort/
  introsort ibrido): non è "instabile" nel senso di "buggato", ma nel senso
  tecnico che non garantisce l'ordine relativo di elementi uguali — più
  veloce del sort stabile quando (come qui) non ci interessa quella garanzia.

## 9. Passo 4 — Compilare in WebAssembly con wasm-pack

```bash
cd wasm-libs/sort-lib
wasm-pack build --target web --release
```

Cosa succede:

1. `cargo` compila il crate per il target `wasm32-unknown-unknown`.
2. `wasm-bindgen` genera i file di binding.
3. Il risultato finisce in `wasm-libs/sort-lib/pkg/`:

```
pkg/
├── sort_lib.js          # loader JS: espone init() + le tue funzioni
├── sort_lib.d.ts         # dichiarazioni TypeScript, tipizzazione completa
├── sort_lib_bg.wasm      # il binario WebAssembly vero e proprio
└── package.json
```

`--target web` genera un modulo pensato per essere importato direttamente
in un progetto ESM come Angular, con una funzione `init()` **asincrona** da
chiamare una volta prima di usare le funzioni esportate (il browser deve
scaricare e compilare il `.wasm` prima che sia utilizzabile).

> Ogni volta che modifichi `lib.rs` devi rilanciare `wasm-pack build`: non è
> automatico, non fa parte della build di Angular.

## 10. Passo 5 — Collegare il pacchetto WASM ad Angular

### 10.1 — Dire ad Angular di includere il file `.wasm` nella build

Con il builder moderno di Angular (`@angular/build:application`, basato su
esbuild/Vite), il file `.wasm` va dichiarato come **asset**, altrimenti il
loader generato da `wasm-pack` (che lo richiede a runtime con `new
URL('sort_lib_bg.wasm', import.meta.url)`) non lo troverà nella build finale.

Apri `angular.json` e, dentro `projects.wasm-demo.architect.build.options`,
aggiungi (o crea) la sezione `assets`:

```json
"assets": [
  {
    "glob": "**/*.wasm",
    "input": "wasm-libs/sort-lib/pkg"
  }
]
```

### 10.2 — Importare il modulo nel codice TypeScript

Il modo più semplice per iniziare è importare direttamente i file generati.
Crea `src/app/sort-wasm.ts`:

```typescript
// Import diretto dal pacchetto generato da wasm-pack.
// Grazie a sort_lib.d.ts, sort_i32 è già tipizzato correttamente.
import init, { sort_i32 } from '../../wasm-libs/sort-lib/pkg/sort_lib.js';

let ready: Promise<unknown> | null = null;

/** Inizializza (una sola volta) il modulo WASM. Va chiamata prima di usare sort_i32. */
export function initSortWasm(): Promise<unknown> {
  if (!ready) {
    ready = init();
  }
  return ready;
}

export { sort_i32 };
```

Incapsulare l'inizializzazione in una funzione con una promise "cache"
(`ready`) evita di richiamare `init()` più volte se più parti dell'app
usano il modulo.

## 11. Passo 6 — Chiamare la funzione Rust al posto di quella JS

Supponiamo di avere già, nel componente, una versione JavaScript "pura":

```typescript
function sortJs(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}
```

Ecco come sostituirla (o affiancarla, per confronto) con la versione WASM in
un componente standalone:

```typescript
import { ChangeDetectionStrategy, Component, type OnInit, signal } from '@angular/core';
import { initSortWasm, sort_i32 } from './sort-wasm';

function sortJs(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <button (click)="run()" [disabled]="!wasmReady()">Ordina 1.000.000 numeri</button>
    @if (resultInfo()) {
      <p>{{ resultInfo() }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  wasmReady = signal(false);
  resultInfo = signal('');

  async ngOnInit() {
    await initSortWasm();   // aspetta che il modulo WASM sia pronto
    this.wasmReady.set(true);
  }

  run() {
    const data = Array.from({ length: 1_000_000 }, () => Math.random() * 1000);

    const t0 = performance.now();
    sortJs(data);
    const jsMs = performance.now() - t0;

    // sort_i32 richiede interi: qui li arrotondiamo per l'esempio.
    const ints = Int32Array.from(data, (v) => Math.round(v));
    const t1 = performance.now();
    sort_i32(ints);
    const rsMs = performance.now() - t1;

    this.resultInfo.set(`JS: ${jsMs.toFixed(2)}ms — Rust/WASM: ${rsMs.toFixed(2)}ms`);
  }
}
```

Punti da notare:

- **`await initSortWasm()`** prima di ogni uso: chiamare una funzione
  `#[wasm_bindgen]` prima che il modulo sia inizializzato lancia un errore
  a runtime. Il pulsante resta disabilitato (`[disabled]="!wasmReady()"`)
  finché il modulo non è pronto — pattern minimo ma robusto.
- La funzione Rust si chiama **esattamente come dall'app**: non c'è
  differenza sintattica fra chiamare `sortJs(...)` e chiamare `sort_i32(...)`
  — è "solo" una funzione TypeScript tipizzata, tutta la complessità di
  wasm-bindgen è nascosta nel file generato.
- Qui misuriamo entrambe le versioni per **confrontarle**: in produzione,
  una volta deciso quale tenere, si tiene solo quella.

## 12. Secondo esempio: verifica di integrità (hash)

Un caso diverso dal precedente: qui lavoriamo su un **buffer di byte**
(`Uint8Array`) invece che su un array di numeri — è il caso tipico di
checksum, cache-busting, verifica di upload lato client, ecc.

`wasm-libs/sort-lib/src/lib.rs` (aggiungi in coda al file):

```rust
/// Hash FNV-1a a 32 bit: veloce, non crittografico, ottimo per checksum
/// e confronti di integrità (NON adatto a password o firme di sicurezza).
#[wasm_bindgen]
pub fn fnv1a_hash(data: &[u8]) -> u32 {
    const OFFSET_BASIS: u32 = 0x811c_9dc5;
    const PRIME: u32 = 0x0100_0193;

    let mut hash = OFFSET_BASIS;
    for &byte in data {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(PRIME); // moltiplicazione con overflow "avvolgente", come atteso dall'algoritmo
    }
    hash
}
```

- `data: &[u8]` è una *vista* di sola lettura su un buffer di byte:
  `wasm-bindgen` la mappa direttamente su un `Uint8Array` JS, senza bisogno
  di conversioni manuali.
- `wrapping_mul` è l'equivalente esplicito della moltiplicazione "che va in
  overflow silenziosamente" che in JavaScript useresti con `Math.imul` — in
  Rust va richiesta esplicitamente (di default un overflow in `debug` fa
  *panic*, comportamento voluto per evitare bug silenziosi).

Dopo aver rilanciato `wasm-pack build --target web --release`, l'uso da
TypeScript è identico al caso precedente:

```typescript
import { fnv1a_hash } from './sort-wasm'; // ri-esporta anche questa

const bytes = new TextEncoder().encode('contenuto da verificare');
const checksum = fnv1a_hash(bytes); // number (u32)
console.log(checksum.toString(16)); // es. "2d3fa9c1"
```

Confronto concettuale con l'esempio precedente:

| | Ordinamento (`sort_i32`) | Hash (`fnv1a_hash`) |
|---|---|---|
| Tipo di dato scambiato | `Vec<i32>` ↔ `Int32Array` | `&[u8]` ↔ `Uint8Array` |
| Direzione del costo di marshaling | in *e* out (l'array torna ordinato) | solo in (esce un singolo `u32`, quasi gratis) |
| Caso d'uso reale | ordinare grandi dataset in memoria | checksum, cache-busting, verifica upload |

## 13. Inizializzazione robusta (evitare race condition)

Nell'esempio del §11 abbiamo usato `await initSortWasm()` dentro
`ngOnInit()`. Funziona, ma se **un altro componente/servizio** prova a usare
il modulo prima che quel particolare componente sia stato istanziato, va in
errore. La soluzione robusta in un'app reale è centralizzare
l'inizializzazione con un **initializer applicativo**, cioè un codice che
Angular garantisce venga eseguito (e atteso) prima di bootstrappare
l'applicazione:

```typescript
// app.config.ts
import { ApplicationConfig, provideAppInitializer } from '@angular/core';
import { initSortWasm } from './sort-wasm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => initSortWasm()),
    // ...altri provider
  ],
};
```

Con `provideAppInitializer`, Angular **aspetta** che la promise si risolva
prima di renderizzare l'app: da quel momento in poi, qualunque componente o
servizio può chiamare le funzioni WASM senza doversi preoccupare
dell'inizializzazione — è già garantita.

> Nota: se il modulo WASM è pesante e non serve nella schermata iniziale,
> valuta piuttosto un caricamento *lazy* (import dinamico al momento
> dell'uso) invece di bloccare il bootstrap dell'intera app — vedi
> [§15](#15-buone-pratiche).

## 14. Organizzare WASM come libreria Angular riutilizzabile

L'approccio del §10 (import diretto dei file generati) è il più semplice per
imparare o per un solo componente. In un progetto reale, soprattutto se più
parti dell'app (o più app nello stesso workspace) usano lo stesso modulo
WASM, conviene incapsularlo in una **libreria Angular** dedicata:

```bash
ng generate library wasm-sort
```

All'interno della libreria (`projects/wasm-sort/src/`):

- copia/genera il crate Rust in `src/lib/sort-lib/` (stessa struttura del
  §7-9);
- in `public-api.ts`, ri-esporta sia le funzioni sia l'`init`:

```typescript
// projects/wasm-sort/src/public-api.ts
import init from './lib/sort-lib/pkg';
export { sort_i32, fnv1a_hash } from './lib/sort-lib/pkg';
export { init as initWasmSort };
```

Vantaggi di questo approccio (è quello usato nel progetto di riferimento
allegato, cartella `projects/wasm-example`):

- **un solo punto di manutenzione** per la parte WASM, versionabile e
  testabile separatamente;
- il resto dell'app importa `import { sort_i32, initWasmSort } from
  'wasm-sort'` esattamente come importerebbe qualunque altra libreria npm;
- più facile da estrarre in un pacchetto pubblicabile se in futuro serve
  ad altri progetti del team.

## 15. Buone pratiche

- **Minimizza le chiamate attraverso il confine.** Se devi processare 10.000
  elementi, non chiamare la funzione WASM 10.000 volte in un loop JS: passa
  l'intero buffer in una sola chiamata e fai il loop *dentro* Rust.
- **Preferisci tipi primitivi e buffer tipizzati** (`number`, `Uint8Array`,
  `Int32Array`, `Float64Array`) a oggetti/JSON quando possibile: sono il
  caso più efficiente per `wasm-bindgen`.
- **Carica il modulo in modo lazy** se non serve subito: un `import()`
  dinamico dentro il metodo/servizio che lo usa, invece che nel bootstrap
  globale, evita di appesantire il caricamento iniziale dell'app per una
  funzionalità usata solo occasionalmente.
- **Gestisci i panic Rust.** Un `panic!` in Rust (es. accesso fuori indice)
  fa fallire la chiamata JS con un errore generico e poco leggibile. In
  sviluppo, aggiungi il crate
  [`console_error_panic_hook`](https://github.com/rustwasm/console_error_panic_hook)
  e chiamalo all'avvio per ottenere stack trace leggibili nella console del
  browser.
- **Valida l'equivalenza, non solo la velocità.** Ogni volta che scrivi una
  versione Rust "gemella" di una funzione JS esistente, scrivi un test che
  verifichi che **producano lo stesso identico output** sugli stessi input
  (non solo che "sembrino" equivalenti) — un bug di conversione (es. arrotondamenti,
  overflow, encoding) è più facile da introdurre di quanto sembri.
- **Versiona `pkg/` con cura.** `wasm-pack build` va rilanciato manualmente
  a ogni modifica di `lib.rs` — non è parte della build di Angular. In CI,
  automatizza questo passo prima della build Angular (o committa `pkg/`
  come fa questo repository, così chi clona non deve avere subito Rust
  installato per far partire l'app).
- **Non dimenticare il bundle size.** Il file `.wasm` + il loader JS si
  aggiungono al peso scaricato dall'utente. Per moduli piccoli è
  trascurabile; per crate con dipendenze pesanti (es. crittografia,
  parsing complesso) misura con gli strumenti di analisi bundle di Angular
  (`ng build --stats-json` + `webpack-bundle-analyzer`, o l'equivalente per
  esbuild) e valuta il lazy loading.

## 16. Come misurare se ne vale davvero la pena

Un singolo confronto "un run JS contro un run Rust" non basta: JIT warm-up,
garbage collection, rumore di sistema possono far sembrare più veloce
l'ambiente sbagliato. Metodologia minima corretta:

1. **Ripeti** ogni misura N volte (almeno 10-20), non una sola.
2. Calcola **media, mediana e deviazione standard** per ciascun ambiente,
   non solo la media (la mediana è più robusta agli outlier).
3. Applica un **test di significatività statistica** (es. t-test di Welch,
   che non assume varianze uguali) per capire se la differenza osservata è
   reale o rumore statistico — una differenza "a occhio" con p-value alto
   (es. > 0.05) potrebbe non essere affidabile.
4. Misura in condizioni **realistiche**: build di produzione (non `ng
   serve` in development, che non ottimizza), sugli input di dimensione
   realmente attesa in produzione (piccoli input spesso non giustificano
   l'overhead WASM anche quando l'algoritmo asintoticamente è più veloce).

Questa esatta metodologia (ripetizioni configurabili, media/mediana/dev.std,
t-test di Welch, tabella con p-value esportabile in CSV) è implementata e
pronta all'uso nella pagina di benchmark del progetto allegato a questa
guida — puoi usarla come "laboratorio" per far sperimentare il team con dati
reali prima di ogni decisione, o come base per il vostro prossimo
esperimento. Vedi [§19](#19-risorse-ed-esempio-di-riferimento).

## 17. Checklist decisionale finale

Prima di proporre WASM per una funzionalità, rispondi a queste domande:

- [ ] **È realmente CPU-bound?** (non I/O, non DOM, non rete)
- [ ] **È stata misurata** come collo di bottiglia reale (profiler/DevTools),
      non solo "sembra lento"?
- [ ] **L'input è abbastanza grande/frequente** da giustificare il costo
      fisso di marshaling e caricamento del modulo?
- [ ] **Esiste già un'API nativa del browser** (es. `crypto.subtle`,
      `Array.prototype.sort`, `JSON.parse`) che fa già il lavoro in modo
      ottimizzato? Se sì, WASM probabilmente non serve.
- [ ] **Un prototipo Rust è stato misurato** (con la metodologia del §16) e
      mostra un guadagno **significativo e stabile**, non solo su un run?
- [ ] **Il team ha (o può acquisire in tempi ragionevoli) le competenze
      Rust** per mantenere quel codice nel tempo?
- [ ] **Il costo di build/CI aggiuntivo** (toolchain Rust, step
      `wasm-pack build`) è accettabile per il progetto?

Se hai risposto "sì" a tutte → **WASM è probabilmente la scelta giusta.**
Se anche solo una risposta è "no" → **resta in JavaScript**, o quantomeno
rimanda la decisione finché quella risposta non cambia.

## 18. Errori comuni e come risolverli

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| `Cannot find module '...pkg/sort_lib.js'` in build | Non hai rilanciato `wasm-pack build` dopo un `git clone`/pull, o il path di import è sbagliato | Rilancia `wasm-pack build --target web --release`; verifica il path relativo |
| Il `.wasm` dà 404 in produzione (ma funziona in dev) | Manca la voce `assets` in `angular.json` (§10.1) | Aggiungi il glob `**/*.wasm` puntando alla cartella `pkg` |
| `TypeError: ... is not a function` chiamando una funzione esportata | Hai chiamato la funzione prima che `init()` si risolvesse | Usa `await init()` (o `provideAppInitializer`, §13) prima di ogni uso |
| Risultati diversi fra JS e Rust sullo stesso input | Differenze di arrotondamento float, overflow interi, o algoritmo non realmente equivalente | Scrivi test cross-language che confrontino gli output byte-per-byte/valore-per-valore su input noti |
| La versione WASM è più lenta della JS | Input troppo piccolo, troppe chiamate piccole invece di una chiamata batch, oppure l'API JS nativa era già ottimale | Rivedi §3/§4: forse questo caso non era adatto a WASM |
| Errore Rust criptico (`panic`) senza stack trace utile | Manca un panic hook leggibile | Aggiungi `console_error_panic_hook` (§15) in fase di sviluppo |

## 19. Risorse ed esempio di riferimento

- **Esempio completo e funzionante**: questo stesso repository
  (`projects/wasm-example` + `projects/example-app`) contiene 9 algoritmi
  reali implementati in coppia JS/Rust (ordinamento, hashing, filtro
  immagine, parsing JSON come contro-esempio, ecc.), con benchmark
  ripetibili, grafici, tabella statistica e export CSV — vedi il
  [`README.md`](./README.md) del repository per le istruzioni di build.
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/) —
  guida ufficiale, più approfondita di questo mini-corso.
- [`wasm-bindgen` guide](https://rustwasm.github.io/docs/wasm-bindgen/) —
  riferimento completo su come i tipi vengono convertiti fra Rust e JS.
- [`wasm-pack`](https://rustwasm.github.io/docs/wasm-pack/) — documentazione
  del build tool.
- [MDN — WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) —
  concetti generali, indipendenti dal linguaggio sorgente.

---

*Questa guida fa parte del progetto dimostrativo `ng-wasm-example`. Per
domande o proposte di miglioramento, apri una issue o parlane con il team.*
