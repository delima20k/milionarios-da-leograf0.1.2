import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const elements = new Map();
const document = {
    addEventListener() {},
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, {});
        return elements.get(id);
    }
};
const context = vm.createContext({ document });
vm.runInContext(source.slice(source.indexOf('// Dados dos comprovantes'), source.indexOf('const btnBuscarResultado')) + '\nglobalThis.dados = { jogos, concursosTeimosinha, valorTotalAposta, atualizarResumoTeimosinha };', context);
const { jogos, concursosTeimosinha: concursos, valorTotalAposta, atualizarResumoTeimosinha } = context.dados;
const oficiais = `02 03 05 08 09 11 12 13 15 16 18 19 21 22 24
02 05 07 08 09 10 11 12 14 18 20 21 22 23 24
02 04 05 06 09 10 12 13 14 15 16 18 20 21 23
01 02 03 04 05 06 07 09 11 13 15 17 18 19 20
01 02 03 05 07 08 09 10 11 13 15 17 18 19 21
01 02 03 04 05 06 07 09 11 12 13 16 17 20 21
01 02 03 05 06 07 10 11 13 14 17 18 20 21 22
02 03 04 06 09 10 13 14 17 19 20 21 22 23 25
02 03 04 07 09 10 11 13 14 15 17 18 20 21 25
01 02 04 06 08 09 11 12 15 16 17 18 20 22 23
01 02 03 05 06 09 11 12 14 18 19 20 21 23 24
01 03 04 06 08 12 13 15 16 17 19 20 21 23 24
02 04 05 06 08 09 11 12 15 17 19 20 21 22 25
01 02 04 06 09 10 11 14 15 16 17 20 22 23 25
01 04 05 07 08 10 11 12 15 17 18 20 21 22 25`.split('\n').map(line => line.split(' ').map(Number));
test('15 jogos iguais aos comprovantes, sem duplicatas e total de R$ 1.260', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(jogos)), oficiais);
    assert.equal(new Set(jogos.map(j => j.join(','))).size, 15);
    for (const jogo of jogos) assert.equal(new Set(jogo).size, 15);
    assert.equal(valorTotalAposta, 1260);
});
test('24 concursos consecutivos de 3805 a 3828', () => {
    assert.equal(concursos.length, 24);
    concursos.forEach((c, i) => { assert.equal(c.concurso, 3805 + i); assert.equal(c.numero, i + 1); });
    assert.equal(concursos[0].data, '15/10/2026');
    assert.equal(concursos[2].data, '18/10/2026');
    assert.equal(concursos[10].data, '27/10/2026');
    assert.equal(concursos[11].data, '28/10/2026');
    assert.equal(concursos[23].concurso, 3828);
    assert.equal(concursos[23].data, '11/11/2026');
    assert.equal(concursos.filter(c => c.prevista).length, 13);
});
test('progresso avança pelo calendário', () => {
    atualizarResumoTeimosinha(Date.parse('2026-10-15T12:00:00-03:00'));
    assert.match(elements.get('progressoTeimosinha').textContent, /0 de 24.*24 restantes/);
    atualizarResumoTeimosinha(Date.parse('2026-10-27T21:00:00-03:00'));
    assert.match(elements.get('progressoTeimosinha').textContent, /11 de 24.*13 restantes/);
    atualizarResumoTeimosinha(concursos[23].dateMs);
    assert.match(elements.get('progressoTeimosinha').textContent, /24 de 24.*0 restantes/);
});
