import { ChangeDetectionStrategy, Component, type OnInit, computed, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  get_buffer_hash,
  get_factorial,
  get_fibonacci,
  get_image_checksum,
  get_json_sum,
  get_mandelbrot_sum,
  get_pattern_count,
  get_prime_count,
  get_sort_checksum,
  initExampleRust,
} from 'wasm-example';

/** One measured (run index, elapsed ms) sample for a single environment. */
interface Sample {
  run: number;
  ms: number;
}

/** Least-squares linear regression y = slope*x + intercept over a point set. */
interface Regression {
  slope: number;
  intercept: number;
}

interface Dot {
  x: number;
  y: number;
  label: string;
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ChartData {
  width: number;
  height: number;
  axisLeft: number;
  axisBottom: number;
  axisTop: number;
  axisRight: number;
  maxMsLabel: string;
  jsDots: Dot[];
  rsDots: Dot[];
  jsLine: Line | null;
  rsLine: Line | null;
  speedup: Speedup | null;
}

/** Which environment was faster, and by how much (>= 1). */
interface Speedup {
  faster: 'js' | 'rs';
  factor: number;
  label: string;
  shortLabel: string;
}

function computeSpeedup(jsMs: number | null, rsMs: number | null, suffix: string): Speedup | null {
  if (jsMs === null || rsMs === null || jsMs <= 0 || rsMs <= 0) {
    return null;
  }

  const faster = jsMs < rsMs ? 'js' : 'rs';
  const factor = faster === 'js' ? rsMs / jsMs : jsMs / rsMs;
  const envName = faster === 'js' ? 'JavaScript' : 'Rust (WASM)';
  const envShort = faster === 'js' ? 'JS' : 'Rust';

  return {
    faster,
    factor,
    label: `${envName} è ${factor.toFixed(2)}× più veloce${suffix}`,
    shortLabel: `${envShort} ${factor.toFixed(2)}× più veloce`,
  };
}

// ---------------------------------------------------------------------------
// Descriptive statistics + Welch's t-test, for the summary table.
// ---------------------------------------------------------------------------

interface EnvStats {
  n: number;
  mean: number;
  median: number;
  stddev: number | null;
  min: number;
  max: number;
}

interface BenchmarkStats {
  js: EnvStats;
  rs: EnvStats;
  speedup: Speedup | null;
  pValue: number | null;
  pValueLabel: string;
  significant: boolean | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation (n-1 denominator); null when fewer than 2 values. */
function stddev(values: number[], meanValue: number): number | null {
  if (values.length < 2) {
    return null;
  }
  const sumSq = values.reduce((acc, v) => acc + (v - meanValue) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

function envStats(samples: Sample[]): EnvStats | null {
  if (samples.length === 0) {
    return null;
  }
  const values = samples.map((s) => s.ms);
  const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    mean: meanValue,
    median: median(values),
    stddev: stddev(values, meanValue),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// Log-gamma (Lanczos approximation) and the regularized incomplete beta
// function, used to turn a Welch t-statistic into a two-tailed p-value
// without pulling in a stats library.
function logGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of cof) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITER = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }

  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-tailed p-value for Student's t distribution with `df` degrees of freedom. */
function tDistributionTwoTailedP(t: number, df: number): number {
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/** Welch's t-test (unequal variance): tests whether two sample means differ. */
function welchTTest(a: number[], b: number[]): { t: number; df: number; p: number } | null {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 2 || n2 < 2) {
    return null;
  }

  const mean1 = a.reduce((x, y) => x + y, 0) / n1;
  const mean2 = b.reduce((x, y) => x + y, 0) / n2;
  const var1 = a.reduce((acc, v) => acc + (v - mean1) ** 2, 0) / (n1 - 1);
  const var2 = b.reduce((acc, v) => acc + (v - mean2) ** 2, 0) / (n2 - 1);

  const se1 = var1 / n1;
  const se2 = var2 / n2;
  const se = Math.sqrt(se1 + se2);
  if (se === 0) {
    return null;
  }

  const t = (mean1 - mean2) / se;
  const df = (se1 + se2) ** 2 / (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1));
  const p = tDistributionTwoTailedP(Math.abs(t), df);

  return { t, df, p };
}

function computeBenchmarkStats(jsSamples: Sample[], rsSamples: Sample[]): BenchmarkStats | null {
  const js = envStats(jsSamples);
  const rs = envStats(rsSamples);
  if (!js || !rs) {
    return null;
  }

  const speedup = computeSpeedup(js.mean, rs.mean, ' in media');
  const test = welchTTest(
    jsSamples.map((s) => s.ms),
    rsSamples.map((s) => s.ms),
  );
  const pValue = test ? test.p : null;
  const pValueLabel =
    pValue === null ? 'n/d (servono ≥2 campioni)' : pValue < 0.0001 ? 'p < 0.0001' : `p = ${pValue.toFixed(4)}`;
  const significant = pValue === null ? null : pValue < 0.05;

  return { js, rs, speedup, pValue, pValueLabel, significant };
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function linearRegression(points: Sample[]): Regression | null {
  const n = points.length;
  if (n < 2) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const { run: x, ms: y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return null;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Runs the same algorithm once in JS and once in Rust/WASM, timing each run
 * independently so the two implementations can be compared side by side.
 * Every run's timings are also kept as samples for the summary scatter plot.
 */
class BenchmarkRunner<T = number> {
  readonly jsResult = signal<string>('');
  readonly rsResult = signal<string>('');
  readonly jsTime = signal<string>('');
  readonly rsTime = signal<string>('');
  readonly calculating = signal<boolean>(false);
  readonly jsSamples = signal<Sample[]>([]);
  readonly rsSamples = signal<Sample[]>([]);

  /** Live value of this benchmark's own input field, kept in sync by the template. */
  readonly currentInput = signal<number>(0);

  private readonly lastJsMs = signal<number | null>(null);
  private readonly lastRsMs = signal<number | null>(null);

  /** Speedup factor for the most recent single run. */
  readonly lastSpeedup = computed(() => computeSpeedup(this.lastJsMs(), this.lastRsMs(), ''));

  readonly jsRegression = computed(() => linearRegression(this.jsSamples()));
  readonly rsRegression = computed(() => linearRegression(this.rsSamples()));

  /** Descriptive stats (mean/median/stddev/min/max) + Welch's t-test, JS vs Rust. */
  readonly stats = computed(() => computeBenchmarkStats(this.jsSamples(), this.rsSamples()));

  private static readonly CHART_WIDTH = 260;
  private static readonly CHART_HEIGHT = 150;
  private static readonly PAD = { top: 10, right: 10, bottom: 20, left: 38 };

  readonly chartData = computed<ChartData | null>(() => {
    const js = this.jsSamples();
    const rs = this.rsSamples();
    if (js.length === 0 && rs.length === 0) {
      return null;
    }

    const { CHART_WIDTH: width, CHART_HEIGHT: height, PAD: pad } = BenchmarkRunner;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const allMs = [...js, ...rs].map((s) => s.ms);
    const maxMs = Math.max(...allMs, 0.001) * 1.15;
    const maxRun = Math.max(1, ...js.map((s) => s.run), ...rs.map((s) => s.run));

    const scaleX = (run: number) =>
      pad.left + (maxRun <= 1 ? innerW / 2 : ((run - 1) / (maxRun - 1)) * innerW);
    const scaleY = (ms: number) => pad.top + innerH - (Math.max(ms, 0) / maxMs) * innerH;

    const toDots = (samples: Sample[], envLabel: string): Dot[] =>
      samples.map((s) => ({
        x: scaleX(s.run),
        y: scaleY(s.ms),
        label: `${envLabel} · run ${s.run}: ${s.ms.toFixed(2)} ms`,
      }));

    const toLine = (reg: Regression | null): Line | null => {
      if (!reg || maxRun <= 1) {
        return null;
      }
      const y1 = reg.slope * 1 + reg.intercept;
      const y2 = reg.slope * maxRun + reg.intercept;
      return { x1: scaleX(1), y1: scaleY(y1), x2: scaleX(maxRun), y2: scaleY(y2) };
    };

    return {
      width,
      height,
      axisLeft: pad.left,
      axisRight: width - pad.right,
      axisTop: pad.top,
      axisBottom: height - pad.bottom,
      maxMsLabel: maxMs >= 100 ? Math.round(maxMs) + ' ms' : maxMs.toFixed(1) + ' ms',
      jsDots: toDots(js, 'JavaScript'),
      rsDots: toDots(rs, 'Rust (WASM)'),
      jsLine: toLine(this.jsRegression()),
      rsLine: toLine(this.rsRegression()),
      speedup: this.stats()?.speedup ?? null,
    };
  });

  private runCount = 0;

  constructor(
    readonly id: string,
    readonly title: string,
    readonly description: string,
    readonly inputLabel: string,
    readonly min: number,
    readonly max: number,
    readonly defaultValue: number,
    private readonly prepare: (n: number) => T,
    private readonly jsFn: (input: T) => string,
    private readonly rsFn: (input: T) => string,
  ) {
    this.currentInput.set(defaultValue);
  }

  /** UI entry point: kicks off a single run, yielding first so "calculating" can paint. */
  run() {
    const n = this.currentInput();
    this.calculating.set(true);
    this.jsResult.set('');
    this.rsResult.set('');

    setTimeout(() => {
      this.runOnce(n);
      this.calculating.set(false);
    }, 50);
  }

  /** Runs both implementations once, synchronously, recording a sample pair. */
  runOnce(n: number): { jsMs: number; rsMs: number } {
    const input = this.prepare(n);

    const jsStart = performance.now();
    const jsRes = this.jsFn(input);
    const jsMs = performance.now() - jsStart;
    this.jsResult.set(jsRes);
    this.jsTime.set((jsMs / 1000).toFixed(4) + 's');

    const rsStart = performance.now();
    const rsRes = this.rsFn(input);
    const rsMs = performance.now() - rsStart;
    this.rsResult.set(rsRes);
    this.rsTime.set((rsMs / 1000).toFixed(4) + 's');

    this.runCount++;
    this.jsSamples.update((s) => [...s, { run: this.runCount, ms: jsMs }]);
    this.rsSamples.update((s) => [...s, { run: this.runCount, ms: rsMs }]);
    this.lastJsMs.set(jsMs);
    this.lastRsMs.set(rsMs);

    return { jsMs, rsMs };
  }

  resetSamples() {
    this.runCount = 0;
    this.jsSamples.set([]);
    this.rsSamples.set([]);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  benchmarks: BenchmarkRunner<any>[] = [];

  readonly repetitions = signal<number>(5);
  readonly runningAll = signal<boolean>(false);
  readonly progress = signal<string>('');
  readonly hasChartData = computed(() => this.benchmarks.some((bm) => bm.chartData() !== null));

  ngOnInit() {
    initExampleRust();

    this.benchmarks = [
      new BenchmarkRunner(
        'factorial',
        'Fattoriale',
        'Calcolo ricorsivo del fattoriale con interi a precisione arbitraria, ripetuto 10.000.000 di volte per ottenere un tempo misurabile.',
        'n',
        1,
        200,
        20,
        (n) => n,
        jsFactorial,
        (n) => get_factorial(n),
      ),
      new BenchmarkRunner(
        'fibonacci',
        'Fibonacci (ricorsivo)',
        'Calcolo ingenuo e ricorsivo (non memoizzato) dell’n-esimo numero di Fibonacci: complessità esponenziale, ottimo per mettere sotto stress la sola velocità delle chiamate di funzione.',
        'n',
        1,
        42,
        32,
        (n) => n,
        jsFibonacci,
        (n) => get_fibonacci(n),
      ),
      new BenchmarkRunner(
        'primes',
        'Crivello di Eratostene',
        'Conteggio dei numeri primi minori o uguali a n tramite il crivello di Eratostene: cicli intensivi su array/buffer.',
        'limite',
        1000,
        50000000,
        10000000,
        (n) => n,
        jsPrimeCount,
        (n) => get_prime_count(n).toString(),
      ),
      new BenchmarkRunner(
        'mandelbrot',
        'Insieme di Mandelbrot',
        'Somma delle iterazioni di fuga calcolate su una griglia n×n del piano complesso (max 200 iterazioni per punto): aritmetica in virgola mobile intensiva.',
        'risoluzione (n×n)',
        50,
        1500,
        500,
        (n) => n,
        jsMandelbrotSum,
        (n) => get_mandelbrot_sum(n),
      ),
      new BenchmarkRunner(
        'sort',
        'Ordinamento array',
        'Generazione di un array di n interi pseudo-casuali (xorshift32 con lo stesso seed in entrambi i linguaggi) e successivo ordinamento: confronto su allocazione, accesso alla memoria e algoritmi di sort.',
        'dimensione array',
        1000,
        5000000,
        1000000,
        (n) => n,
        jsSortChecksum,
        (n) => get_sort_checksum(n),
      ),
      new BenchmarkRunner(
        'image',
        'Filtro immagine (scala di grigi + blur)',
        'Genera un buffer RGBA pseudo-casuale, lo converte in scala di grigi e applica una sfocatura a box 3×3: caso reale di editing/elaborazione immagini lato client (es. thumbnail, filtri).',
        'lato immagine (n×n px)',
        50,
        1200,
        400,
        (n) => n,
        jsImageChecksum,
        (n) => get_image_checksum(n),
      ),
      new BenchmarkRunner(
        'hash',
        'Hashing (FNV-1a)',
        'Calcolo di un hash FNV-1a a 32 bit su un buffer di byte pseudo-casuali: caso reale di checksum/integrità dati, cache-busting, deduplicazione lato client.',
        'dimensione buffer (byte)',
        1000,
        20000000,
        2000000,
        (n) => n,
        jsBufferHash,
        (n) => get_buffer_hash(n),
      ),
      new BenchmarkRunner(
        'json',
        'Parsing JSON (contro-esempio)',
        'Genera una stringa JSON di n numeri e ne calcola la somma dopo il parsing. Il testo è generato una sola volta e passato identico a entrambi gli ambienti: qui JSON.parse nativo, fortemente ottimizzato dal motore JS, può reggere il confronto con Rust — anche a causa del costo di marshaling della stringa attraverso il confine WASM.',
        'numero di elementi',
        1000,
        2000000,
        200000,
        (n) => buildJsonArray(n),
        jsJsonSum,
        (json) => get_json_sum(json),
      ),
      new BenchmarkRunner(
        'pattern',
        'Ricerca di sottostringa (scan manuale)',
        'Scansione byte-per-byte di un testo pseudo-casuale alla ricerca di un pattern, scritta a mano invece di usare API stringa native (indexOf/includes): tipico di parser, tokenizer, sanitizzatori o motori di template custom scritti da zero.',
        'lunghezza testo',
        10000,
        20000000,
        2000000,
        (n) => n,
        jsPatternCount,
        (n) => get_pattern_count(n).toString(),
      ),
    ];
  }

  async runAll() {
    if (this.runningAll()) {
      return;
    }

    const times = Math.max(1, Math.min(50, this.repetitions()));
    this.runningAll.set(true);

    for (const bm of this.benchmarks) {
      bm.resetSamples();
    }

    for (let run = 1; run <= times; run++) {
      for (let i = 0; i < this.benchmarks.length; i++) {
        const bm = this.benchmarks[i];
        this.progress.set(`Ripetizione ${run}/${times} — ${bm.title} (${i + 1}/${this.benchmarks.length})`);
        // Yield so the progress label actually paints between (blocking) runs.
        await new Promise((resolve) => setTimeout(resolve, 0));
        bm.runOnce(bm.currentInput());
      }
    }

    this.progress.set('');
    this.runningAll.set(false);
  }

  downloadCsv() {
    const header = [
      'Test',
      'Ambiente',
      'Parametro (n)',
      'Campioni',
      'Media (ms)',
      'Mediana (ms)',
      'Dev.std (ms)',
      'Min (ms)',
      'Max (ms)',
      'Speedup (fattore)',
      'Ambiente più veloce',
      'p-value (Welch t-test)',
      'Significativo (p<0.05)',
    ];
    const rows: string[][] = [header];

    for (const bm of this.benchmarks) {
      const s = bm.stats();
      if (!s) {
        continue;
      }

      const param = bm.currentInput().toString();
      const pValueStr = s.pValue === null ? '' : s.pValue.toFixed(6);
      const significantStr = s.significant === null ? '' : s.significant ? 'si' : 'no';
      const speedupFactor = s.speedup ? s.speedup.factor.toFixed(2) : '';
      const speedupFaster = s.speedup ? (s.speedup.faster === 'js' ? 'JavaScript' : 'Rust (WASM)') : '';

      for (const [envLabel, env] of [
        ['JavaScript', s.js],
        ['Rust (WASM)', s.rs],
      ] as const) {
        rows.push([
          bm.title,
          envLabel,
          param,
          env.n.toString(),
          env.mean.toFixed(4),
          env.median.toFixed(4),
          env.stddev !== null ? env.stddev.toFixed(4) : '',
          env.min.toFixed(4),
          env.max.toFixed(4),
          speedupFactor,
          speedupFaster,
          pValueStr,
          significantStr,
        ]);
      }
    }

    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark-js-vs-rust-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// JavaScript reference implementations — mirror the Rust algorithms in
// projects/wasm-example/src/lib/example-rust-lib/src/lib.rs as closely as
// possible so the two sides are actually comparable.
// ---------------------------------------------------------------------------

function xorshift32(state: { v: number }): number {
  let x = state.v | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.v = x >>> 0;
  return state.v;
}

// --- factorial ---

function factorialRec(x: bigint): bigint {
  return x === 0n ? 1n : x * factorialRec(x - 1n);
}

function jsFactorial(n: number): string {
  let f = 0n;
  for (let i = 0; i < 10000000; i++) {
    f = factorialRec(BigInt(n));
  }
  return f.toString();
}

// --- fibonacci ---

function fibonacciRec(n: number): number {
  return n < 2 ? n : fibonacciRec(n - 1) + fibonacciRec(n - 2);
}

function jsFibonacci(n: number): string {
  return fibonacciRec(n).toString();
}

// --- primes ---

function jsPrimeCount(limit: number): string {
  if (limit < 2) {
    return '0';
  }

  const isPrime = new Uint8Array(limit + 1).fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;

  for (let i = 2; i * i <= limit; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= limit; j += i) {
        isPrime[j] = 0;
      }
    }
  }

  let count = 0;
  for (let i = 0; i <= limit; i++) {
    count += isPrime[i];
  }
  return count.toString();
}

// --- mandelbrot ---

function jsMandelbrotSum(size: number): string {
  const MAX_ITER = 200;
  let total = 0;

  for (let py = 0; py < size; py++) {
    const y0 = (py / size) * 2.5 - 1.25;
    for (let px = 0; px < size; px++) {
      const x0 = (px / size) * 3.5 - 2.5;

      let x = 0;
      let y = 0;
      let iter = 0;

      while (x * x + y * y <= 4 && iter < MAX_ITER) {
        const xTemp = x * x - y * y + x0;
        y = 2 * x * y + y0;
        x = xTemp;
        iter++;
      }

      total += iter;
    }
  }

  return total.toString();
}

// --- sort ---

function jsSortChecksum(n: number): string {
  const state = { v: 2463534242 };
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    arr[i] = xorshift32(state) % 1_000_000;
  }
  arr.sort((a, b) => a - b);

  const last = Math.max(n - 1, 0);
  return `min=${arr[0]}, median=${arr[Math.floor(last / 2)]}, max=${arr[last]}`;
}

// --- image filter ---

function generateImage(size: number): Uint8Array {
  const state = { v: 2463534242 };
  const len = size * size * 4;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = xorshift32(state) & 0xff;
  }
  return buf;
}

function jsImageChecksum(size: number): string {
  const buf = generateImage(size);
  const w = size;
  const h = size;

  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = buf[i * 4];
    const g = buf[i * 4 + 1];
    const b = buf[i * 4 + 2];
    gray[i] = (77 * r + 150 * g + 29 * b) >> 8;
  }

  const blurred = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = Math.min(Math.max(y + dy, 0), h - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.min(Math.max(x + dx, 0), w - 1);
          sum += gray[ny * w + nx];
        }
      }
      blurred[y * w + x] = (sum / 9) | 0;
    }
  }

  let total = 0;
  for (let i = 0; i < blurred.length; i++) {
    total += blurred[i];
  }
  return total.toString();
}

// --- hashing ---

function jsBufferHash(size: number): string {
  const OFFSET_BASIS = 0x811c9dc5;
  const PRIME = 0x01000193;

  const state = { v: 2463534242 };
  let hash = OFFSET_BASIS;

  for (let i = 0; i < size; i++) {
    const byte = xorshift32(state) & 0xff;
    hash ^= byte;
    hash = Math.imul(hash, PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

// --- JSON parsing ---

function buildJsonArray(n: number): string {
  const state = { v: 2463534242 };
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    const cents = xorshift32(state) % 100000;
    parts[i] = (cents / 100).toFixed(2);
  }
  return '[' + parts.join(',') + ']';
}

function jsJsonSum(jsonStr: string): string {
  const arr = JSON.parse(jsonStr) as number[];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum.toFixed(2);
}

// --- substring search ---

function jsPatternCount(len: number): string {
  const state = { v: 2463534242 };
  const text = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    text[i] = 97 + (xorshift32(state) % 26);
  }

  const pattern = [119, 97, 115, 109]; // 'w', 'a', 's', 'm'
  let count = 0;

  if (text.length >= pattern.length) {
    for (let i = 0; i <= text.length - pattern.length; i++) {
      let matched = true;
      for (let j = 0; j < pattern.length; j++) {
        if (text[i + j] !== pattern[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        count++;
      }
    }
  }

  return count.toString();
}
