import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
function setup(storage = new Map()) {
    const elements = new Map();
    const callbacks = [];
    const element = () => ({style:{}, appendChild(){}, textContent:'', innerHTML:''});
    const context = vm.createContext({
        console: {log(){},warn(){}},
        localStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
        document: {
            addEventListener: (_, fn)=>callbacks.push(fn),
            querySelector:()=>null, querySelectorAll:()=>[], createElement:element,
            getElementById(id){ if(!elements.has(id)) elements.set(id,element());return elements.get(id); }
        },
        concursosTeimosinha: [{concurso:3768},{concurso:3769}],
        atualizarBotaoVisual(){},
    });
    const start = source.indexOf('// A chave identifica esta aposta');
    const end = source.indexOf('// Limpar total acumulado', start);
    vm.runInContext('let botoesTeimosinha = {concursosVerificados: new Map()};\n' + source.slice(start,end), context);
    return {context, elements, callbacks, storage};
}
test('soma concursos distintos, substitui repetidos e conta concursos sem prêmio', () => {
    const {context,elements}=setup();
    vm.runInContext(`registrarResultadoAcumulado({concurso:3768,totalConcurso:12.50,jogosResultado:[]});
        registrarResultadoAcumulado({concurso:3768,totalConcurso:15,jogosResultado:[]});
        registrarResultadoAcumulado({concurso:3769,totalConcurso:0,jogosResultado:[]});`,context);
    assert.equal(elements.get('totalAcumuladoBotoes').textContent,'R$ 15,00');
    assert.equal(elements.get('botoesVerificadosCount').textContent,2);
});
test('restaura a soma ao recarregar e não soma simulações ou outra aposta', () => {
    const first=setup();
    vm.runInContext(`registrarResultadoAcumulado({concurso:3768,totalConcurso:7,jogosResultado:[]});
        registrarResultadoAcumulado({concurso:3769,totalConcurso:100,simulado:true});
        registrarResultadoAcumulado({concurso:3741,totalConcurso:200});`,first.context);
    const second=setup(first.storage);second.callbacks.forEach(fn=>fn());
    assert.equal(second.elements.get('totalAcumuladoBotoes').textContent,'R$ 7,00');
    assert.equal(second.elements.get('botoesVerificadosCount').textContent,1);
    vm.runInContext('botoesTeimosinha.concursosVerificados.clear(); atualizarTotalAcumuladoDisplay();',second.context);
    const third=setup(second.storage);third.callbacks.forEach(fn=>fn());
    assert.equal(JSON.parse([...third.storage.values()][0]).length,0);
});
test('verificação de todos os concursos alimenta o mesmo painel sem duplicar', async () => {
    const {context,elements}=setup();
    Object.assign(context,{jogos:[],verificacaoContainer:{style:{}},setTimeout(){},verificarJogosDoConursoTeimosinha:async r=>({...r,totalConcurso:10,jogosResultado:[]})});
    vm.runInContext(source.slice(source.indexOf('async function verificarTodosJogos('),source.indexOf('// ============================================',source.indexOf('async function verificarTodosJogos('))),context);
    for(let i=0;i<2;i++) await vm.runInContext('verificarTodosJogos([{concurso:3768,data:"21/08/2026",numerosSorteados:[]}],23)',context);
    assert.equal(elements.get('totalAcumuladoBotoes').textContent,'R$ 10,00');
    assert.equal(elements.get('botoesVerificadosCount').textContent,1);
});
