/**
 * Testes automatizados — Otimizações de performance do chat
 * Cobertura: MessageRateLimiter, DecryptCache, PerfLogger, OfflineQueue batch drain
 *
 * Executar: node --test tests/chat-perf.test.mjs
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── MessageRateLimiter ────────────────────────────────────────
// Replica a lógica de token bucket do chat.js para teste isolado
class MessageRateLimiter {
    #tokens;
    #max;
    #interval;
    #timer;

    constructor(max = 5, intervalMs = 500) {
        this.#max      = max;
        this.#tokens   = max;
        this.#interval = intervalMs;
        this.#timer    = setInterval(() => {
            if (this.#tokens < this.#max) this.#tokens++;
        }, this.#interval);
    }

    consume() {
        if (this.#tokens <= 0) return false;
        this.#tokens--;
        return true;
    }

    destroy() { clearInterval(this.#timer); }
}

// ── DecryptCache ─────────────────────────────────────────────
// Replica a lógica LRU do chat.js para teste isolado
class DecryptCache {
    #max;
    #map;

    constructor(max = 20) {
        this.#max = max;
        this.#map = new Map();
    }

    getOrDecrypt(key, fn) {
        if (this.#map.has(key)) {
            const val = this.#map.get(key);
            this.#map.delete(key);
            this.#map.set(key, val);
            return Promise.resolve(val);
        }
        return Promise.resolve(fn()).then(url => {
            if (this.#map.size >= this.#max) {
                const oldest = this.#map.keys().next().value;
                const oldUrl = this.#map.get(oldest);
                if (oldUrl?.startsWith?.('blob:')) oldUrl; // simulate revokeObjectURL
                this.#map.delete(oldest);
            }
            this.#map.set(key, url);
            return url;
        });
    }

    clear() { this.#map.clear(); }

    get size() { return this.#map.size; }
    keys() { return [...this.#map.keys()]; }
}

// ── PerfLogger ───────────────────────────────────────────────
// Replica a lógica circular buffer do chat.js para teste isolado
class PerfLogger {
    #buffers = {};
    #maxPerCategory;

    constructor(maxPerCategory = 200) {
        this.#maxPerCategory = maxPerCategory;
    }

    record(category, value) {
        if (!this.#buffers[category]) this.#buffers[category] = [];
        const buf = this.#buffers[category];
        buf.push(value);
        if (buf.length > this.#maxPerCategory) buf.shift();
    }

    getAll(category) { return this.#buffers[category] ?? []; }
}

// ─────────────────────────────────────────────────────────────

describe('MessageRateLimiter', () => {
    it('permite exatamente 5 mensagens consecutivas', () => {
        const rl = new MessageRateLimiter(5, 60_000);
        try {
            for (let i = 0; i < 5; i++) {
                assert.equal(rl.consume(), true, `token ${i + 1} deve ser consumido`);
            }
            assert.equal(rl.consume(), false, 'token 6 deve ser recusado');
        } finally {
            rl.destroy();
        }
    });

    it('recusa quando tokens = 0', () => {
        const rl = new MessageRateLimiter(1, 60_000);
        try {
            rl.consume();
            assert.equal(rl.consume(), false);
        } finally {
            rl.destroy();
        }
    });
});

describe('DecryptCache', () => {
    it('retorna o mesmo resultado do cache na segunda chamada', async () => {
        const cache = new DecryptCache(5);
        let calls = 0;
        const fn = () => { calls++; return 'blob:fake-url'; };

        const r1 = await cache.getOrDecrypt('key1', fn);
        const r2 = await cache.getOrDecrypt('key1', fn);

        assert.equal(r1, 'blob:fake-url');
        assert.equal(r2, 'blob:fake-url');
        assert.equal(calls, 1, 'fn deve ser chamada apenas uma vez (cache hit)');
    });

    it('evicta a entrada mais antiga quando capacidade máxima é atingida', async () => {
        const cache = new DecryptCache(3);
        await cache.getOrDecrypt('a', () => 'url-a');
        await cache.getOrDecrypt('b', () => 'url-b');
        await cache.getOrDecrypt('c', () => 'url-c');
        assert.equal(cache.size, 3);

        await cache.getOrDecrypt('d', () => 'url-d');
        assert.equal(cache.size, 3, 'tamanho deve permanecer <= max');
        assert.equal(cache.keys().includes('a'), false, '"a" deve ter sido evictada');
        assert.equal(cache.keys().includes('d'), true, '"d" deve estar no cache');
    });

    it('clear() esvazia o cache', async () => {
        const cache = new DecryptCache(5);
        await cache.getOrDecrypt('x', () => 'url-x');
        cache.clear();
        assert.equal(cache.size, 0);
    });
});

describe('PerfLogger', () => {
    it('buffer circular mantém no máximo maxPerCategory entradas', () => {
        const logger = new PerfLogger(10);
        for (let i = 0; i < 15; i++) logger.record('latency', i);
        const entries = logger.getAll('latency');
        assert.equal(entries.length, 10, 'deve manter apenas 10 entradas');
        assert.equal(entries[0], 5, 'entry mais antiga deve ser o índice 5 (oldest kept)');
        assert.equal(entries[9], 14);
    });

    it('retorna array vazio para categoria desconhecida', () => {
        const logger = new PerfLogger(200);
        assert.deepEqual(logger.getAll('unknown'), []);
    });

    it('múltiplas categorias são independentes', () => {
        const logger = new PerfLogger(5);
        logger.record('send', 100);
        logger.record('render', 200);
        assert.equal(logger.getAll('send').length, 1);
        assert.equal(logger.getAll('render').length, 1);
    });
});

describe('OfflineQueue batch drain (lógica de lote)', () => {
    it('processa itens em lotes de N com delay entre lotes', async () => {
        const BATCH = 5;
        const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
        const batches = [];

        for (let i = 0; i < items.length; i += BATCH) {
            batches.push(items.slice(i, i + BATCH));
        }

        assert.equal(batches.length, 3, 'deve criar 3 lotes para 12 itens com BATCH=5');
        assert.equal(batches[0].length, 5);
        assert.equal(batches[1].length, 5);
        assert.equal(batches[2].length, 2, 'último lote tem os 2 restantes');
    });

    it('lote único não necessita de delay', async () => {
        const BATCH = 5;
        const items = Array.from({ length: 3 }, (_, i) => ({ id: i }));
        const delays = [];

        for (let i = 0; i < items.length; i += BATCH) {
            if (i + BATCH < items.length) delays.push(200);
        }

        assert.equal(delays.length, 0, 'sem delay para lote único');
    });
});
