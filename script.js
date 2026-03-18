// ============================================
// 🦁💵 SPLASH SCREEN 3D - PRIMEIRA ABERTURA
// ============================================
(function() {
    const splashScreen = document.getElementById('splashScreen');
    
    if (splashScreen) {
        // Verifica se já foi mostrada hoje
        const hoje = new Date().toDateString();
        const ultimaSplash = localStorage.getItem('splashMostrada');
        
        if (ultimaSplash === hoje) {
            // Já mostrou hoje, esconde imediatamente
            splashScreen.classList.add('hidden');
        } else {
            // Primeira vez hoje - mostra a splash
            document.body.style.overflow = 'hidden'; // Bloqueia scroll durante splash
            
            // Após 10 segundos, remove a splash e libera o app
            setTimeout(() => {
                splashScreen.classList.add('hidden');
                document.body.style.overflow = ''; // Libera scroll
                localStorage.setItem('splashMostrada', hoje);
            }, 10000);
        }
    }
})();

// ============================================
// 🎮 MENSAGEM DE BOAS-VINDAS (3 SEGUNDOS)
// ============================================
(function() {
    const welcomeTooltip = document.getElementById('welcomeTooltip');
    const welcomeClose = document.getElementById('welcomeClose');
    const btnPaciencia = document.getElementById('btnPaciencia');
    
    // Verifica se já foi fechada hoje
    const hoje = new Date().toDateString();
    const ultimoFechamento = localStorage.getItem('welcomeTooltipFechado');
    
    if (ultimoFechamento === hoje && welcomeTooltip) {
        welcomeTooltip.classList.add('hidden');
    } else if (welcomeTooltip) {
        // ⏱️ Desaparece automaticamente após 3 segundos (depois da splash)
        setTimeout(() => {
            welcomeTooltip.classList.add('hidden');
            localStorage.setItem('welcomeTooltipFechado', hoje);
        }, 13000); // 10s splash + 3s tooltip
    }
    
    // Fechar a mensagem manualmente (botão X)
    if (welcomeClose) {
        welcomeClose.addEventListener('click', () => {
            welcomeTooltip.classList.add('hidden');
            localStorage.setItem('welcomeTooltipFechado', hoje);
        });
    }
    
    // Fechar ao clicar no botão de paciência
    if (btnPaciencia && welcomeTooltip) {
        btnPaciencia.addEventListener('click', () => {
            welcomeTooltip.classList.add('hidden');
            localStorage.setItem('welcomeTooltipFechado', hoje);
        }, { once: true });
    }
})();

// ============================================
// MENU HAMBÚRGUER
// ============================================

// Elementos
const hamburger = document.getElementById('hamburger');
const sideMenu = document.getElementById('sideMenu');

// Criar overlay
const overlay = document.createElement('div');
overlay.className = 'overlay';
document.body.appendChild(overlay);

// Função para abrir menu (bloqueia scroll da página)
function abrirMenu() {
    hamburger.classList.add('active');
    sideMenu.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // 🔒 Bloqueia scroll da página
    document.body.style.touchAction = 'none'; // 🔒 Bloqueia touch scroll
}

// Função para fechar menu (libera scroll da página)
function fecharMenu() {
    hamburger.classList.remove('active');
    sideMenu.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // 🔓 Libera scroll da página
    document.body.style.touchAction = ''; // 🔓 Libera touch scroll
}

// Toggle do menu
hamburger.addEventListener('click', () => {
    if (sideMenu.classList.contains('active')) {
        fecharMenu();
    } else {
        abrirMenu();
    }
});

// Fechar menu ao clicar no overlay
overlay.addEventListener('click', fecharMenu);

// Previne que o scroll do menu propague para a página
sideMenu.addEventListener('touchmove', (e) => {
    e.stopPropagation();
}, { passive: true });

// Adicionar evento de clique aos itens do menu
const menuItems = document.querySelectorAll('.menu-item');
menuItems.forEach(item => {
    item.addEventListener('click', () => {
        console.log(`Selecionado: ${item.textContent}`);
        // Aqui você pode adicionar mais funcionalidades quando clicar em um nome
    });
});

// ============================================
// 📲 INSTALAR PWA - BOTÃO NO HEADER
// ============================================
(function() {
    let deferredPrompt = null;
    const btnInstalar = document.getElementById('btnInstalarPWA');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (btnInstalar) {
            btnInstalar.style.display = 'inline-flex';
            btnInstalar.style.alignItems = 'center';
            btnInstalar.style.gap = '6px';
        }
    });

    if (btnInstalar) {
        btnInstalar.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`📲 Instalação: ${outcome}`);
            deferredPrompt = null;
            btnInstalar.style.display = 'none';
        });
    }

    window.addEventListener('appinstalled', () => {
        if (btnInstalar) btnInstalar.style.display = 'none';
        deferredPrompt = null;
        console.log('✅ PWA instalado com sucesso!');
    });
})();

// ============================================
// 🎉 MODAL PARABÉNS + CONFETTI
// ============================================
const ModalParabens = (function() {
    let confettiInterval = null;
    const particles = [];

    const CORES = ['#f1c40f','#2ecc71','#e74c3c','#3498db','#9b59b6','#e67e22','#1abc9c','#fff'];

    function criarParticula(canvas) {
        return {
            x: Math.random() * canvas.width,
            y: -10,
            r: Math.random() * 8 + 4,
            cor: CORES[Math.floor(Math.random() * CORES.length)],
            speed: Math.random() * 4 + 2,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.2,
            drift: (Math.random() - 0.5) * 2,
            forma: Math.random() > 0.5 ? 'rect' : 'circle'
        };
    }

    function iniciarConfetti() {
        const canvas = document.getElementById('confettiCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        particles.length = 0;

        let tick = 0;
        if (confettiInterval) cancelAnimationFrame(confettiInterval);

        function frame() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            tick++;
            if (tick % 3 === 0 && particles.length < 200) {
                for (let i = 0; i < 5; i++) particles.push(criarParticula(canvas));
            }
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.y += p.speed;
                p.x += p.drift;
                p.angle += p.spin;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillStyle = p.cor;
                ctx.globalAlpha = 0.9;
                if (p.forma === 'rect') {
                    ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
                if (p.y > canvas.height + 20) particles.splice(i, 1);
            }
            if (document.getElementById('modalParabens') && document.getElementById('modalParabens').style.display !== 'none') {
                confettiInterval = requestAnimationFrame(frame);
            }
        }
        confettiInterval = requestAnimationFrame(frame);
    }

    function pararConfetti() {
        if (confettiInterval) {
            cancelAnimationFrame(confettiInterval);
            confettiInterval = null;
        }
        const canvas = document.getElementById('confettiCanvas');
        if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        particles.length = 0;
    }

    function mostrar(jogosPremiados, numeroConcurso) {
        const modal = document.getElementById('modalParabens');
        const sub = document.getElementById('modalParabensSub');
        const jogosDiv = document.getElementById('modalParabensJogos');
        if (!modal) return;

        const maxPontos = Math.max(...jogosPremiados.map(j => j.totalAcertos));
        const emojis = { 15: '👑🌟', 14: '🏅✨', 13: '🎯⭐' };
        const estrelas = maxPontos >= 15 ? '🌟🌟🌟🌟🌟' : maxPontos === 14 ? '🌟🌟🌟🌟' : '🌟🌟🌟';

        sub.textContent = `Concurso ${numeroConcurso} — ${jogosPremiados.length} jogo(s) com 13+ pontos! ${estrelas}`;

        jogosDiv.innerHTML = jogosPremiados.map(j => `
            <div class="modal-jogo-premiado">
                <div class="mjp-info">Jogo ${j.numeroJogo}</div>
                <div class="mjp-pontos">${j.totalAcertos} pts</div>
                <div class="mjp-estrelas">${emojis[j.totalAcertos] || '⭐'}</div>
            </div>
        `).join('');

        modal.style.display = 'flex';
        iniciarConfetti();

        const fechar = document.getElementById('modalParabensFechar');
        if (fechar) {
            fechar.onclick = () => {
                modal.style.display = 'none';
                pararConfetti();
            };
        }
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                pararConfetti();
            }
        };
    }

    return { mostrar };
})();

// ============================================
// BUSCAR RESULTADO DA LOTOFÁCIL
// ============================================

// Jogos do bolão - 20 jogos (Teimosinha 24x a partir de 23/02/2026)
const jogos = [
    [2, 4, 5, 8, 9, 10, 11, 14, 15, 18, 19, 20, 21, 22, 23],
    [1, 3, 5, 6, 7, 10, 11, 13, 14, 17, 20, 21, 22, 23, 25],
    [1, 2, 3, 6, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 25],
    [2, 4, 5, 6, 7, 9, 11, 12, 15, 17, 19, 20, 21, 22, 25],
    [1, 2, 4, 6, 9, 10, 11, 14, 15, 16, 17, 20, 22, 23, 25],
    [1, 4, 5, 7, 9, 10, 11, 12, 15, 17, 18, 20, 21, 22, 25],
    [1, 2, 3, 5, 6, 7, 10, 11, 13, 14, 17, 18, 20, 21, 22],
    [2, 3, 4, 6, 9, 10, 13, 14, 17, 19, 20, 21, 22, 23, 25],
    [2, 3, 4, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 25],
    [1, 2, 4, 6, 8, 9, 11, 12, 15, 16, 17, 18, 20, 22, 23],
    [1, 2, 3, 5, 6, 9, 11, 12, 14, 18, 19, 20, 21, 23, 24],
    [1, 3, 4, 6, 8, 12, 13, 15, 16, 17, 19, 20, 21, 23, 24],
    [1, 4, 5, 6, 7, 8, 11, 12, 15, 16, 19, 20, 21, 22, 23],
    [1, 2, 4, 6, 7, 9, 11, 14, 15, 16, 17, 20, 21, 22, 25],
    [1, 4, 5, 6, 7, 10, 11, 12, 15, 17, 18, 20, 22, 23, 25],
    [2, 4, 5, 7, 8, 9, 11, 14, 15, 18, 19, 20, 21, 22, 23],
    [1, 2, 4, 7, 8, 10, 11, 12, 15, 16, 18, 20, 22, 23, 25],
    [1, 4, 5, 8, 9, 10, 11, 14, 15, 16, 19, 20, 21, 22, 23],
    [2, 3, 4, 5, 6, 7, 10, 11, 13, 14, 17, 19, 20, 21, 23],
    [1, 3, 4, 7, 9, 10, 13, 14, 15, 17, 18, 19, 21, 22, 23]
];

// Mapeamento de concursos - DINÂMICO desde o 3586 até o atual
// Teimosinha de 24 sorteios a partir de 13/01/2026
function gerarConcursosTeimosinha() {
    const concursos = [];
    // Usar formato com horário para evitar problemas de fuso horário
    const dataInicio = new Date(2026, 1, 23); // 23/02/2026 - Concurso 3619 (Teimosinha 24x)
    const hoje = new Date();
    
    // Gerar todos os 24 concursos da teimosinha independente da data atual
    let concursoAtual = 3619;
    let dataAtual = new Date(dataInicio);
    
    const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    
    // Gerar todos os 24 concursos da teimosinha
    while (concursos.length < 24) {
        const diaSemana = dataAtual.getDay();
        
        // Lotofácil não tem sorteio aos domingos
        if (diaSemana !== 0) {
            const dataFormatada = dataAtual.toLocaleDateString('pt-BR');
            const diaTexto = diasSemana[diaSemana];
            
            concursos.push({
                data: dataFormatada,
                concurso: concursoAtual,
                dia: diaTexto
            });
            
            concursoAtual++;
        }
        
        // Avançar para o próximo dia
        dataAtual.setDate(dataAtual.getDate() + 1);
    }
    
    console.log(`📅 Gerados ${concursos.length} concursos para verificação (do 3619 até ${concursoAtual - 1})`);
    console.log(`📊 Teimosinha 24x iniciada em 23/02/2026 - 20 jogos por sorteio`);
    return concursos;
}

// Gerar lista dinâmica de concursos
const concursosTeimosinha = gerarConcursosTeimosinha();

const btnBuscarResultado = document.getElementById('btnBuscarResultado');
const resultadoContainer = document.getElementById('resultadoContainer');
const verificacaoContainer = document.getElementById('verificacaoContainer');

let todosResultados = [];

btnBuscarResultado.addEventListener('click', async () => {
    try {
        // Mostrar loading no botão
        btnBuscarResultado.textContent = '⏳ Verificando do concurso 3586 até o atual...';
        btnBuscarResultado.disabled = true;

        // Limpar resultados anteriores
        todosResultados = [];

        console.log('🔍 Iniciando busca COMPLETA desde o concurso 3586...');
        console.log(`📊 Total de concursos a verificar: ${concursosTeimosinha.length}`);
        console.log(`📅 Período: ${concursosTeimosinha[0].data} (${concursosTeimosinha[0].concurso}) até ${concursosTeimosinha[concursosTeimosinha.length - 1].data} (${concursosTeimosinha[concursosTeimosinha.length - 1].concurso})`);

        let concursosEncontrados = 0;
        let ultimoConcursoReal = null;
        let errosConsecutivos = 0;

        // Buscar todos os concursos desde o 3586
        for (const concursoInfo of concursosTeimosinha) {
            try {
                console.log(`📊 Buscando concurso ${concursoInfo.concurso} (${concursoInfo.data} - ${concursoInfo.dia})`);
                
                const response = await fetch(`https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil/${concursoInfo.concurso}`);
                
                if (response.ok) {
                    const dados = await response.json();
                    
                    // Verificar se tem números sorteados
                    if (dados.listaDezenas && dados.listaDezenas.length > 0) {
                        console.log(`✅ Concurso ${concursoInfo.concurso} encontrado e CONFERIDO!`);
                        todosResultados.push({
                            ...concursoInfo,
                            dados: dados,
                            numerosSorteados: dados.listaDezenas.map(n => parseInt(n))
                        });
                        console.log(`📝 Números sorteados: ${dados.listaDezenas.join(', ')}`);
                        concursosEncontrados++;
                        ultimoConcursoReal = concursoInfo.concurso;
                        errosConsecutivos = 0; // Reset contador de erros
                    } else {
                        console.log(`⚠️ Concurso ${concursoInfo.concurso} sem números sorteados`);
                        errosConsecutivos++;
                    }
                } else {
                    console.log(`❌ Concurso ${concursoInfo.concurso} ainda não realizado (status: ${response.status})`);
                    errosConsecutivos++;
                    
                    // Se já temos alguns resultados e encontramos 3 erros consecutivos, provavelmente chegamos no limite
                    if (concursosEncontrados > 0 && errosConsecutivos >= 3) {
                        console.log(`🛑 Parando busca após ${errosConsecutivos} erros consecutivos. Último concurso válido: ${ultimoConcursoReal}`);
                        break;
                    }
                }
            } catch (error) {
                console.log(`⚠️ Erro ao buscar concurso ${concursoInfo.concurso}:`, error.message);
                errosConsecutivos++;
                
                // Se erro na API e já temos alguns resultados e muitos erros consecutivos, parar
                if (concursosEncontrados > 0 && errosConsecutivos >= 5) {
                    console.log(`🛑 Parando busca por muitos erros de API consecutivos (${errosConsecutivos})`);
                    break;
                }
            }

            // Pequeno delay para não sobrecarregar a API
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        console.log(`📋 RESULTADO DA BUSCA:`);
        console.log(`   ✅ Concursos encontrados: ${todosResultados.length}`);
        console.log(`   📊 Período verificado: Concurso 3586 até ${ultimoConcursoReal || 'atual'}`);
        console.log(`   📅 Datas: ${todosResultados.length > 0 ? `${todosResultados[0].data} até ${todosResultados[todosResultados.length - 1].data}` : 'Nenhuma'}`);

        if (todosResultados.length === 0) {
            // Se não encontrou resultados reais, usar dados simulados para teste
            console.log('⚠️ Nenhum resultado real encontrado. Oferecendo demonstração...');
            
            const confirm = window.confirm(
                'Nenhum resultado oficial foi encontrado ainda.\n\n' +
                '🎯 O sistema buscou desde o concurso 3525 (29/10/2025) até o atual\n\n' +
                'Deseja ver uma demonstração com dados simulados para testar o sistema?\n\n' +
                '(Clique OK para ver a demonstração ou Cancelar para aguardar os resultados oficiais)'
            );
            
            if (confirm) {
                todosResultados = criarDadosSimulados();
                console.log('🎭 Usando dados simulados para demonstração');
            } else {
                alert('⏳ Aguardando resultados oficiais dos concursos.\n\n📊 O sistema verificará automaticamente todos os concursos desde o 3525 quando estiverem disponíveis.');
                btnBuscarResultado.textContent = '🤖 Verificar Todos os Concursos da Teimosinha';
                btnBuscarResultado.disabled = false;
                return;
            }
        }

        // Mostrar o último resultado no card principal
        const ultimoResultado = todosResultados[todosResultados.length - 1];
        mostrarResultadoPrincipal(ultimoResultado);

        // Verificar todos os jogos em todos os concursos
        verificarTodosJogos(todosResultados);
        
        // Scroll suave até o resultado
        resultadoContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Restaurar botão
        btnBuscarResultado.textContent = '🤖 Verificar Todos os Concursos da Teimosinha';
        btnBuscarResultado.disabled = false;

    } catch (error) {
        console.error('❌ Erro geral:', error);
        alert('Erro ao buscar resultados. Verifique o console para mais detalhes.');
        
        // Restaurar botão
        btnBuscarResultado.textContent = '🤖 Verificar Todos os Concursos da Teimosinha';
        btnBuscarResultado.disabled = false;
    }
});

// Função para mostrar o resultado principal (último concurso)
function mostrarResultadoPrincipal(resultado) {
    const dados = resultado.dados;
    
    // Preencher informações
    document.getElementById('numeroConcurso').textContent = `${dados.numero} - ${resultado.dia}`;
    document.getElementById('dataConcurso').textContent = dados.dataApuracao;
    
    // Formatar prêmio
    const premio = new Intl.NumberFormat('pt-BR', { 
        style: 'currency', 
        currency: 'BRL' 
    }).format(dados.valorEstimadoProximoConcurso);
    document.getElementById('valorPremio').textContent = premio;

    // Pegar ganhadores de 15 pontos
    const ganhadores15 = dados.listaRateioPremio.find(item => item.faixa === 1);
    document.getElementById('ganhadores15').textContent = 
        `${ganhadores15.numeroDeGanhadores} ganhador(es) - ${new Intl.NumberFormat('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        }).format(ganhadores15.valorPremio)} cada`;

    // Mostrar números sorteados
    const numerosGrid = document.getElementById('numerosSorteados');
    numerosGrid.innerHTML = '';
    
    const numerosOrdenados = [...resultado.numerosSorteados].sort((a, b) => a - b);
    numerosOrdenados.forEach(numero => {
        const bola = document.createElement('div');
        bola.className = 'numero-bola';
        bola.textContent = numero.toString().padStart(2, '0');
        numerosGrid.appendChild(bola);
    });

    // Mostrar container de resultado
    resultadoContainer.style.display = 'block';
}

// Função para verificar todos os jogos em todos os concursos
function verificarTodosJogos(resultados) {
    console.log('🎯 Iniciando verificação de todos os jogos...');
    
    const resumoPremios = document.getElementById('resumoPremios');
    const jogosVerificados = document.getElementById('jogosVerificados');
    
    // Limpar containers
    resumoPremios.innerHTML = '';
    jogosVerificados.innerHTML = '';
    
    // Contadores gerais de todos os concursos
    const contadoresGerais = {
        15: { qtd: 0, valor: 0 },
        14: { qtd: 0, valor: 0 },
        13: { qtd: 0, valor: 0 },
        12: { qtd: 0, valor: 0 },
        11: { qtd: 0, valor: 0 }
    };
    
    // Array para armazenar prêmios de cada jogo
    const premiosPorJogo = Array(jogos.length).fill(0).map(() => 0);
    
    let totalGeralAcumulado = 0;
    
    console.log(`📊 Verificando ${resultados.length} concurso(s)...`);
    
    // Para cada concurso
    resultados.forEach((resultado, indexConcurso) => {
        console.log(`\n🔍 === CONCURSO ${resultado.concurso} (${resultado.data}) ===`);
        console.log(`📋 Números sorteados: [${resultado.numerosSorteados.join(', ')}]`);
        
        // Criar seção do concurso
        const concursoSection = document.createElement('div');
        concursoSection.style.cssText = 'margin-bottom: 40px; padding: 25px; background: rgba(255, 255, 255, 0.02); border-radius: 15px; border: 2px solid rgba(255, 255, 255, 0.1);';
        
        const concursoTitle = document.createElement('h4');
        concursoTitle.style.cssText = 'color: #f39c12; font-size: 22px; margin-bottom: 20px; text-align: center;';
        concursoTitle.textContent = `📅 ${resultado.dia} - ${resultado.data} - Concurso ${resultado.concurso}`;
        concursoSection.appendChild(concursoTitle);
        
        // Mostrar números sorteados deste concurso
        const numerosDiv = document.createElement('div');
        numerosDiv.style.cssText = 'display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px;';
        resultado.numerosSorteados.sort((a, b) => a - b).forEach(num => {
            const numSpan = document.createElement('span');
            numSpan.style.cssText = 'background: #2ecc71; color: #fff; padding: 8px 12px; border-radius: 50%; font-weight: bold; min-width: 35px; text-align: center;';
            numSpan.textContent = num.toString().padStart(2, '0');
            numerosDiv.appendChild(numSpan);
        });
        concursoSection.appendChild(numerosDiv);
        
        let totalConcurso = 0;
        let temJogoComPremio = false;
        const jogos13maisBulk = []; // 🎉 Rastrear jogos com 13+
        
        // Verificar cada jogo neste concurso
        jogos.forEach((jogo, indexJogo) => {
            const acertos = jogo.filter(num => resultado.numerosSorteados.includes(num));
            const totalAcertos = acertos.length;
            
            console.log(`🎲 Jogo ${indexJogo + 1}: [${jogo.join(', ')}]`);
            console.log(`   ✅ Acertos: [${acertos.join(', ')}] = ${totalAcertos} pontos`);
            
            // 🎉 Registrar jogos com 13+ pontos para modal
            if (totalAcertos >= 13) {
                jogos13maisBulk.push({ numeroJogo: indexJogo + 1, totalAcertos });
            }
            
            let valorPremioJogo = 0;
            
            // Contar acertos (a partir de 11 pontos)
            if (totalAcertos >= 11) {
                console.log(`   🏆 PRÊMIO! ${totalAcertos} pontos`);
                contadoresGerais[totalAcertos].qtd++;
                
                // Mapear faixas de prêmio da Lotofácil:
                // 15 acertos = faixa 1, 14 acertos = faixa 2, etc.
                const faixa = 16 - totalAcertos; // 15→1, 14→2, 13→3, 12→4, 11→5
                
                console.log(`   💰 Buscando prêmio da faixa ${faixa}...`);
                
                const premio = resultado.dados.listaRateioPremio.find(p => p.faixa === faixa);
                if (premio) {
                    valorPremioJogo = premio.valorPremio;
                    contadoresGerais[totalAcertos].valor += valorPremioJogo;
                    totalConcurso += valorPremioJogo;
                    premiosPorJogo[indexJogo] += valorPremioJogo;
                    temJogoComPremio = true;
                    
                    console.log(`   💎 Valor do prêmio: R$ ${valorPremioJogo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
                } else {
                    console.log(`   ⚠️ Prêmio não encontrado para faixa ${faixa}`);
                }
            }
            
            // Criar card do jogo apenas se tiver pelo menos 11 pontos
            if (totalAcertos >= 11) {
                const jogoCard = document.createElement('div');
                jogoCard.className = `jogo-verificado pontos-${totalAcertos}`;
                jogoCard.style.cssText = 'margin-bottom: 15px;';
                
                // Header do jogo
                const jogoHeader = document.createElement('div');
                jogoHeader.className = 'jogo-header';
                
                const jogoNumero = document.createElement('div');
                jogoNumero.className = 'jogo-numero';
                jogoNumero.textContent = `Jogo ${indexJogo + 1}`;
                
                const jogoPontos = document.createElement('div');
                jogoPontos.className = `jogo-pontos acertos-${totalAcertos}`;
                jogoPontos.textContent = `${totalAcertos} acertos`;
                
                jogoHeader.appendChild(jogoNumero);
                jogoHeader.appendChild(jogoPontos);
                
                // Números do jogo
                const numerosContainer = document.createElement('div');
                numerosContainer.className = 'jogo-numeros-container';
                
                jogo.forEach(numero => {
                    const numeroItem = document.createElement('div');
                    numeroItem.className = `jogo-numero-item ${acertos.includes(numero) ? 'acertou' : ''}`;
                    numeroItem.textContent = numero.toString().padStart(2, '0');
                    numerosContainer.appendChild(numeroItem);
                });
                
                jogoCard.appendChild(jogoHeader);
                jogoCard.appendChild(numerosContainer);
                
                // Mostrar prêmio deste concurso
                if (valorPremioJogo > 0) {
                    const premioDiv = document.createElement('div');
                    premioDiv.className = 'jogo-premio';
                    premioDiv.innerHTML = `<div class="jogo-premio-valor">Prêmio neste concurso: ${new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: 'BRL' 
                    }).format(valorPremioJogo)}</div>`;
                    jogoCard.appendChild(premioDiv);
                }
                
                concursoSection.appendChild(jogoCard);
            }
        });

        // 🎉 Mostrar modal de parabéns se há jogos com 13+ pontos
        if (jogos13maisBulk.length > 0) {
            const concursoNum = resultado.concurso;
            const delay = indexConcurso * 200; // escalonar modais se houver vários concursos
            setTimeout(() => ModalParabens.mostrar(jogos13maisBulk, concursoNum), 800 + delay);
        }
        
        // Total deste concurso
        if (totalConcurso > 0) {
            const totalConcursoDiv = document.createElement('div');
            totalConcursoDiv.style.cssText = 'margin-top: 20px; padding: 15px; background: rgba(46, 204, 113, 0.15); border-radius: 8px; text-align: center; border: 2px solid #2ecc71;';
            totalConcursoDiv.innerHTML = `<div style="color: #fff; font-size: 18px; font-weight: bold;">Total ganho neste concurso: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(totalConcurso)}</div>`;
            concursoSection.appendChild(totalConcursoDiv);
            totalGeralAcumulado += totalConcurso;
            
            console.log(`   💰 TOTAL DO CONCURSO: R$ ${totalConcurso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
        } else {
            const semPremioDiv = document.createElement('div');
            semPremioDiv.style.cssText = 'margin-top: 15px; padding: 12px; background: rgba(149, 165, 166, 0.1); border-radius: 8px; text-align: center; color: #95a5a6; font-style: italic;';
            semPremioDiv.textContent = 'Nenhum prêmio neste concurso';
            concursoSection.appendChild(semPremioDiv);
            
            console.log(`   ❌ Nenhum jogo pontuou 11+ neste concurso`);
        }
        
        // Só adicionar seção se teve pelo menos 1 jogo com prêmio ou mostrar que não teve
        jogosVerificados.appendChild(concursoSection);
    });
    
    console.log(`\n🏆 === RESUMO FINAL ===`);
    console.log(`💰 Total Geral Acumulado: R$ ${totalGeralAcumulado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log(`📊 Período verificado: Concurso ${resultados[0].concurso} (${resultados[0].data}) até ${resultados[resultados.length - 1].concurso} (${resultados[resultados.length - 1].data})`);
    console.log(`📅 Total de ${resultados.length} concurso(s) analisados`);
    console.log(`🎯 Resumo por pontuação:`);
    for (let pontos = 15; pontos >= 11; pontos--) {
        console.log(`   ${pontos} pontos: ${contadoresGerais[pontos].qtd} vez(es) - R$ ${contadoresGerais[pontos].valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    }
    
    // Criar resumo geral de TODOS os concursos
    const primeiroResultado = resultados[0];
    const ultimoResultado = resultados[resultados.length - 1];
    
    const resumoHTML = `
        <h4 style="color: #fff; text-align: center; font-size: 24px; margin-bottom: 15px;">📊 RESUMO GERAL - ANÁLISE COMPLETA</h4>
        <div style="background: rgba(52, 152, 219, 0.15); padding: 15px; border-radius: 10px; margin-bottom: 20px; border: 2px solid rgba(52, 152, 219, 0.3);">
            <div style="color: #3498db; text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 10px;">
                🗓️ PERÍODO ANALISADO
            </div>
            <div style="color: #fff; text-align: center; font-size: 16px;">
                <strong>Do Concurso ${primeiroResultado.concurso}</strong> (${primeiroResultado.data}) 
                <strong>até o Concurso ${ultimoResultado.concurso}</strong> (${ultimoResultado.data})<br>
                <span style="color: #f39c12;">📈 Total: ${resultados.length} concurso(s) verificado(s)</span>
            </div>
        </div>
        <div class="resumo-item acerto-15">
            <span class="resumo-label">🏆 15 Pontos:</span>
            <span class="resumo-valor">${contadoresGerais[15].qtd} vez(es) - Total: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(contadoresGerais[15].valor)}</span>
        </div>
        <div class="resumo-item acerto-14">
            <span class="resumo-label">⭐ 14 Pontos:</span>
            <span class="resumo-valor">${contadoresGerais[14].qtd} vez(es) - Total: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(contadoresGerais[14].valor)}</span>
        </div>
        <div class="resumo-item acerto-13">
            <span class="resumo-label">💎 13 Pontos:</span>
            <span class="resumo-valor">${contadoresGerais[13].qtd} vez(es) - Total: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(contadoresGerais[13].valor)}</span>
        </div>
        <div class="resumo-item acerto-12">
            <span class="resumo-label">🎯 12 Pontos:</span>
            <span class="resumo-valor">${contadoresGerais[12].qtd} vez(es) - Total: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(contadoresGerais[12].valor)}</span>
        </div>
        <div class="resumo-item acerto-11">
            <span class="resumo-label">✨ 11 Pontos:</span>
            <span class="resumo-valor">${contadoresGerais[11].qtd} vez(es) - Total: ${new Intl.NumberFormat('pt-BR', { 
                style: 'currency', 
                currency: 'BRL' 
            }).format(contadoresGerais[11].valor)}</span>
        </div>
    `;
    
    resumoPremios.innerHTML = resumoHTML;
    
    // ========================================
    // TABELA DE PRÊMIOS POR JOGO
    // ========================================
    const tabelaJogosDiv = document.createElement('div');
    tabelaJogosDiv.style.cssText = 'margin-top: 30px; padding: 25px; background: rgba(52, 152, 219, 0.1); border-radius: 15px; border: 2px solid rgba(52, 152, 219, 0.3);';
    
    const tabelaTitle = document.createElement('h4');
    tabelaTitle.style.cssText = 'color: #3498db; text-align: center; font-size: 22px; margin-bottom: 20px;';
    tabelaTitle.textContent = '💎 TOTAL ACUMULADO POR JOGO';
    tabelaJogosDiv.appendChild(tabelaTitle);
    
    // Criar lista de jogos com totais
    premiosPorJogo.forEach((totalJogo, index) => {
        const jogoItem = document.createElement('div');
        jogoItem.style.cssText = `
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 15px 20px; 
            margin: 10px 0; 
            background: ${totalJogo > 0 ? 'rgba(46, 204, 113, 0.15)' : 'rgba(149, 165, 166, 0.1)'}; 
            border-radius: 8px; 
            border-left: 4px solid ${totalJogo > 0 ? '#2ecc71' : '#95a5a6'};
        `;
        
        const jogoLabel = document.createElement('span');
        jogoLabel.style.cssText = 'color: #fff; font-size: 18px; font-weight: bold;';
        jogoLabel.textContent = `Jogo ${index + 1}`;
        
        const jogoValor = document.createElement('span');
        jogoValor.style.cssText = `color: ${totalJogo > 0 ? '#2ecc71' : '#95a5a6'}; font-size: 20px; font-weight: bold;`;
        jogoValor.textContent = new Intl.NumberFormat('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        }).format(totalJogo);
        
        jogoItem.appendChild(jogoLabel);
        jogoItem.appendChild(jogoValor);
        tabelaJogosDiv.appendChild(jogoItem);
        
        console.log(`🎲 Jogo ${index + 1}: R$ ${totalJogo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    });
    
    resumoPremios.appendChild(tabelaJogosDiv);
    
    // TOTAL GERAL ACUMULADO
    const totalDiv = document.createElement('div');
    totalDiv.style.cssText = 'margin-top: 25px; padding: 25px; background: linear-gradient(135deg, rgba(46, 204, 113, 0.3), rgba(39, 174, 96, 0.3)); border-radius: 15px; text-align: center; border: 3px solid #2ecc71; box-shadow: 0 8px 25px rgba(46, 204, 113, 0.4);';
    totalDiv.innerHTML = `
        <div style="color: #f1c40f; font-size: 18px; margin-bottom: 10px;">💰 TOTAL GERAL ACUMULADO 💰</div>
        <div style="color: #fff; font-size: 36px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">${new Intl.NumberFormat('pt-BR', { 
            style: 'currency', 
            currency: 'BRL' 
        }).format(totalGeralAcumulado)}</div>
        <div style="color: #2ecc71; font-size: 16px; margin-top: 10px; font-weight: bold;">
            📊 Período: Concurso ${primeiroResultado.concurso} até ${ultimoResultado.concurso}
        </div>
        <div style="color: #fff; font-size: 16px; margin-top: 5px;">
            📅 ${primeiroResultado.data} até ${ultimoResultado.data} (${resultados.length} concursos)
        </div>
        <div style="color: #f39c12; font-size: 16px; margin-top: 8px; font-weight: bold;">
            🎯 Soma de todos os 18 jogos em TODOS os sorteios
        </div>
    `;
    resumoPremios.appendChild(totalDiv);
    
    // Mostrar container de verificação
    verificacaoContainer.style.display = 'block';
}

// ============================================
// FUNÇÃO PARA CRIAR DADOS SIMULADOS (TESTE)
// ============================================
function criarDadosSimulados() {
    console.log('🎭 Criando dados simulados para demonstração...');
    console.log('📋 Teimosinha 24x a partir de 13/01/2026 (concurso 3586)');
    
    const dadosSimulados = [
        {
            data: '13/01/2026',
            concurso: 3586,
            dia: 'Terça-feira',
            numerosSorteados: [1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 18, 19, 20, 21, 22],
            dados: {
                numero: 3586,
                dataApuracao: '13/01/2026',
                valorEstimadoProximoConcurso: 1500000,
                listaDezenas: ['01', '02', '03', '05', '07', '09', '11', '13', '15', '17', '18', '19', '20', '21', '22'],
                listaRateioPremio: [
                    { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 }, // 15 pontos
                    { faixa: 2, numeroDeGanhadores: 12, valorPremio: 1847.65 }, // 14 pontos
                    { faixa: 3, numeroDeGanhadores: 225, valorPremio: 30 }, // 13 pontos
                    { faixa: 4, numeroDeGanhadores: 8920, valorPremio: 12 }, // 12 pontos
                    { faixa: 5, numeroDeGanhadores: 115000, valorPremio: 6 } // 11 pontos
                ]
            }
        },
        {
            data: '14/01/2026',
            concurso: 3587,
            dia: 'Quarta-feira',
            numerosSorteados: [2, 3, 5, 7, 9, 11, 13, 15, 17, 18, 19, 20, 21, 23, 25],
            dados: {
                numero: 3587,
                dataApuracao: '14/01/2026',
                valorEstimadoProximoConcurso: 1600000,
                listaDezenas: ['02', '03', '05', '07', '09', '11', '13', '15', '17', '18', '19', '20', '21', '23', '25'],
                listaRateioPremio: [
                    { faixa: 1, numeroDeGanhadores: 1, valorPremio: 1200000 }, // 15 pontos
                    { faixa: 2, numeroDeGanhadores: 8, valorPremio: 2250.50 }, // 14 pontos
                    { faixa: 3, numeroDeGanhadores: 180, valorPremio: 30 }, // 13 pontos
                    { faixa: 4, numeroDeGanhadores: 7800, valorPremio: 12 }, // 12 pontos
                    { faixa: 5, numeroDeGanhadores: 98000, valorPremio: 6 } // 11 pontos
                ]
            }
        },
        {
            data: '15/01/2026',
            concurso: 3588,
            dia: 'Quinta-feira',
            numerosSorteados: [1, 3, 5, 7, 9, 11, 13, 15, 17, 18, 19, 20, 21, 22, 24],
            dados: {
                numero: 3588,
                dataApuracao: '15/01/2026',
                valorEstimadoProximoConcurso: 1700000,
                listaDezenas: ['01', '03', '05', '07', '09', '11', '13', '15', '17', '18', '19', '20', '21', '22', '24'],
                listaRateioPremio: [
                    { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 }, // 15 pontos
                    { faixa: 2, numeroDeGanhadores: 15, valorPremio: 1650.80 }, // 14 pontos
                    { faixa: 3, numeroDeGanhadores: 290, valorPremio: 30 }, // 13 pontos
                    { faixa: 4, numeroDeGanhadores: 9200, valorPremio: 12 }, // 12 pontos
                    { faixa: 5, numeroDeGanhadores: 105000, valorPremio: 6 } // 11 pontos
                ]
            }
        },
        {
            data: '16/01/2026',
            concurso: 3589,
            dia: 'Sexta-feira',
            numerosSorteados: [1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 18, 19, 20, 21, 23],
            dados: {
                numero: 3589,
                dataApuracao: '16/01/2026',
                valorEstimadoProximoConcurso: 1800000,
                listaDezenas: ['01', '02', '03', '05', '07', '09', '11', '13', '15', '17', '18', '19', '20', '21', '23'],
                listaRateioPremio: [
                    { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 }, // 15 pontos
                    { faixa: 2, numeroDeGanhadores: 18, valorPremio: 1425.30 }, // 14 pontos
                    { faixa: 3, numeroDeGanhadores: 320, valorPremio: 30 }, // 13 pontos
                    { faixa: 4, numeroDeGanhadores: 9800, valorPremio: 12 }, // 12 pontos
                    { faixa: 5, numeroDeGanhadores: 118000, valorPremio: 6 } // 11 pontos
                ]
            }
        }
    ];
    
    console.log('📊 Dados simulados criados com 4 concursos:', dadosSimulados.map(d => `${d.concurso} (${d.data})`).join(', '));
    return dadosSimulados;
}

// ============================================
// 24 BOTÕES DAS TEIMOSINHAS
// ============================================

// Estado dos 24 botões
let botoesTeimosinha = {
    concursosVerificados: new Map(), // Map<concurso, {data, resultado, total}>
    totalAcumulado: 0,
    contadorVerificados: 0
};

// Lista fixa dos 24 concursos da teimosinha (13/01/2026 a partir do concurso 3586)
const teimosinhaConcursos = [
    { numero: 1, data: '13/01/2026', dia: 'Terça-feira', concurso: 3586 },
    { numero: 2, data: '14/01/2026', dia: 'Quarta-feira', concurso: 3587 },
    { numero: 3, data: '15/01/2026', dia: 'Quinta-feira', concurso: 3588 },
    { numero: 4, data: '16/01/2026', dia: 'Sexta-feira', concurso: 3589 },
    { numero: 5, data: '17/01/2026', dia: 'Sábado', concurso: 3590 },
    { numero: 6, data: '19/01/2026', dia: 'Segunda-feira', concurso: 3591 },
    { numero: 7, data: '20/01/2026', dia: 'Terça-feira', concurso: 3592 },
    { numero: 8, data: '21/01/2026', dia: 'Quarta-feira', concurso: 3593 },
    { numero: 9, data: '22/01/2026', dia: 'Quinta-feira', concurso: 3594 },
    { numero: 10, data: '23/01/2026', dia: 'Sexta-feira', concurso: 3595 },
    { numero: 11, data: '24/01/2026', dia: 'Sábado', concurso: 3596 },
    { numero: 12, data: '26/01/2026', dia: 'Segunda-feira', concurso: 3597 },
    { numero: 13, data: '27/01/2026', dia: 'Terça-feira', concurso: 3598 },
    { numero: 14, data: '28/01/2026', dia: 'Quarta-feira', concurso: 3599 },
    { numero: 15, data: '29/01/2026', dia: 'Quinta-feira', concurso: 3600 },
    { numero: 16, data: '30/01/2026', dia: 'Sexta-feira', concurso: 3601 },
    { numero: 17, data: '31/01/2026', dia: 'Sábado', concurso: 3602 },
    { numero: 18, data: '02/02/2026', dia: 'Segunda-feira', concurso: 3603 },
    { numero: 19, data: '03/02/2026', dia: 'Terça-feira', concurso: 3604 },
    { numero: 20, data: '04/02/2026', dia: 'Quarta-feira', concurso: 3605 },
    { numero: 21, data: '05/02/2026', dia: 'Quinta-feira', concurso: 3606 },
    { numero: 22, data: '06/02/2026', dia: 'Sexta-feira', concurso: 3607 },
    { numero: 23, data: '07/02/2026', dia: 'Sábado', concurso: 3608 },
    { numero: 24, data: '09/02/2026', dia: 'Segunda-feira', concurso: 3609 }
];

// Inicializar os 24 botões quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 Inicializando 24 botões das teimosinhas...');
    gerar24BotoesTeimosinha();
    setupBotoesEventos();
});

// Gerar os 24 botões das teimosinhas
function gerar24BotoesTeimosinha() {
    const botoesContainer = document.getElementById('botoesTeimosinha');
    if (!botoesContainer) {
        console.log('⚠️ Elemento botoesTeimosinha não encontrado');
        return;
    }

    console.log('🔘 Gerando 24 botões das teimosinhas...');
    
    botoesContainer.innerHTML = '';

    // Data atual para comparação (usar data do sistema)
    const dataAtual = new Date();
    dataAtual.setHours(0, 0, 0, 0);

    teimosinhaConcursos.forEach((teimosinha) => {
        const botaoElement = document.createElement('div');
        botaoElement.className = 'botao-teimosinha nao-verificado';
        botaoElement.setAttribute('data-concurso', teimosinha.concurso);
        botaoElement.setAttribute('data-numero', teimosinha.numero);

        // Determinar se o concurso já passou
        const partes = teimosinha.data.split('/');
        const dataConcurso = new Date(partes[2], partes[1] - 1, partes[0]);
        dataConcurso.setHours(0, 0, 0, 0);
        
        const jaPassou = dataConcurso <= dataAtual;
        const isFuturo = dataConcurso > dataAtual;

        if (isFuturo) {
            botaoElement.classList.add('futuro');
        }

        botaoElement.innerHTML = `
            <div class="teimosinha-numero">${teimosinha.numero}ª Teimosinha</div>
            <div class="teimosinha-data">${teimosinha.data}</div>
            <div class="teimosinha-dia">${teimosinha.dia}</div>
            <div class="teimosinha-concurso">Concurso ${teimosinha.concurso}</div>
            <div class="teimosinha-status ${isFuturo ? 'status-futuro' : 'status-nao-sorteado'}">
                ${isFuturo ? '⏳ Futuro' : '🎲 Clique para verificar'}
            </div>
            <div class="teimosinha-valor valor-aguardando">
                ${isFuturo ? 'Aguardando sorteio' : 'Clique para verificar'}
            </div>
        `;

        // Adicionar evento de clique apenas para concursos não futuros
        if (!isFuturo) {
            botaoElement.addEventListener('click', () => verificarConcursoTeimosinha(teimosinha));
        }

        botoesContainer.appendChild(botaoElement);
    });

    console.log('✅ 24 botões das teimosinhas gerados com sucesso!');
}

// Configurar eventos dos botões
function setupBotoesEventos() {
    const btnLimparTotal = document.getElementById('btnLimparTotalAcumulado');

    if (btnLimparTotal) {
        btnLimparTotal.addEventListener('click', limparTotalAcumulado);
    }

    console.log('🔧 Eventos dos botões configurados');
}

// Verificar concurso da teimosinha
async function verificarConcursoTeimosinha(teimosinha) {
    console.log(`🔍 Verificando ${teimosinha.numero}ª teimosinha - Concurso ${teimosinha.concurso}`);
    
    const botaoElement = document.querySelector(`[data-concurso="${teimosinha.concurso}"]`);
    
    try {
        // Mostrar loading
        if (botaoElement) {
            const valorElement = botaoElement.querySelector('.teimosinha-valor');
            const statusElement = botaoElement.querySelector('.teimosinha-status');
            
            valorElement.textContent = '⏳ Verificando...';
            statusElement.textContent = '🔄 Buscando resultado...';
        }

        // Verificar se já temos o resultado em cache
        if (botoesTeimosinha.concursosVerificados.has(teimosinha.concurso)) {
            console.log(`📋 Usando resultado em cache para concurso ${teimosinha.concurso}`);
            const resultadoCache = botoesTeimosinha.concursosVerificados.get(teimosinha.concurso);
            mostrarResultadoConcursoIndividual(resultadoCache);
            return;
        }

        // Buscar da API
        console.log(`📡 Buscando concurso ${teimosinha.concurso} da API...`);
        const response = await fetch(`https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil/${teimosinha.concurso}`);
        
        let resultado;
        
        if (response.ok) {
            const dados = await response.json();
            
            if (dados.listaDezenas && dados.listaDezenas.length > 0) {
                console.log(`✅ Dados oficiais encontrados para concurso ${teimosinha.concurso}`);
                resultado = {
                    ...teimosinha,
                    dados: dados,
                    numerosSorteados: dados.listaDezenas.map(n => parseInt(n)),
                    oficial: true
                };
            } else {
                throw new Error('Dados incompletos');
            }
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // Verificar jogos e calcular prêmios
        const resultadoCompleto = await verificarJogosDoConursoTeimosinha(resultado);
        
        // Salvar no cache
        botoesTeimosinha.concursosVerificados.set(teimosinha.concurso, resultadoCompleto);
        
        // Atualizar total acumulado
        botoesTeimosinha.totalAcumulado += resultadoCompleto.totalConcurso;
        botoesTeimosinha.contadorVerificados++;
        atualizarTotalAcumuladoDisplay();
        
        // Atualizar visual do botão
        atualizarBotaoVisual(botaoElement, resultadoCompleto);
        
        // Mostrar resultado
        mostrarResultadoConcursoIndividual(resultadoCompleto);
        verificarEMostrarModalParabens(resultadoCompleto);
        
        console.log(`✅ Verificação concluída para ${teimosinha.numero}ª teimosinha`);
        
    } catch (error) {
        console.log(`⚠️ Erro ao verificar concurso ${teimosinha.concurso}:`, error.message);
        
        // Oferecer dados simulados para teste
        if (confirm(`Concurso ${teimosinha.concurso} ainda não disponível.\n\nDeseja ver uma simulação para testar o sistema?`)) {
            const dadosSimulados = criarDadoSimuladoParaTeimosinha(teimosinha);
            const resultadoCompleto = await verificarJogosDoConursoTeimosinha(dadosSimulados);
            
            // Marcar como simulado
            resultadoCompleto.simulado = true;
            botoesTeimosinha.concursosVerificados.set(teimosinha.concurso, resultadoCompleto);
            
            // Atualizar total acumulado
            botoesTeimosinha.totalAcumulado += resultadoCompleto.totalConcurso;
            botoesTeimosinha.contadorVerificados++;
            atualizarTotalAcumuladoDisplay();
            
            // Atualizar visual do botão
            atualizarBotaoVisual(botaoElement, resultadoCompleto);
            
            // Mostrar resultado
            mostrarResultadoConcursoIndividual(resultadoCompleto);
            verificarEMostrarModalParabens(resultadoCompleto);
        } else {
            // Restaurar texto original
            if (botaoElement) {
                const valorElement = botaoElement.querySelector('.teimosinha-valor');
                const statusElement = botaoElement.querySelector('.teimosinha-status');
                
                valorElement.textContent = 'Clique para verificar';
                statusElement.textContent = '🎲 Clique para verificar';
            }
        }
    }
}

// Verificar jogos do concurso da teimosinha
async function verificarJogosDoConursoTeimosinha(concursoResultado) {
    console.log(`🎯 Verificando jogos para ${concursoResultado.numero}ª teimosinha - concurso ${concursoResultado.concurso}...`);
    
    const jogosResultado = [];
    let totalConcurso = 0;
    
    // Verificar cada um dos 18 jogos
    jogos.forEach((jogo, indexJogo) => {
        const acertos = jogo.filter(num => concursoResultado.numerosSorteados.includes(num));
        const totalAcertos = acertos.length;
        
        let valorPremio = 0;
        let temPremio = false;
        
        if (totalAcertos >= 11) {
            temPremio = true;
            const faixa = 16 - totalAcertos; // 15→1, 14→2, etc.
            const premio = concursoResultado.dados.listaRateioPremio.find(p => p.faixa === faixa);
            
            if (premio) {
                valorPremio = premio.valorPremio;
                totalConcurso += valorPremio;
            }
        }
        
        jogosResultado.push({
            numeroJogo: indexJogo + 1,
            numeros: jogo,
            acertos: acertos,
            totalAcertos: totalAcertos,
            temPremio: temPremio,
            valorPremio: valorPremio
        });
        
        console.log(`🎲 Jogo ${indexJogo + 1}: ${totalAcertos} acertos${temPremio ? ` - R$ ${valorPremio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}`);
    });
    
    console.log(`💰 Total da ${concursoResultado.numero}ª teimosinha: R$ ${totalConcurso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    
    return {
        ...concursoResultado,
        jogosResultado: jogosResultado,
        totalConcurso: totalConcurso,
        temPremio: totalConcurso > 0
    };
}

// 🎉 Verificar se há jogos com 13+ pontos e mostrar modal
function verificarEMostrarModalParabens(resultadoCompleto) {
    const jogos13mais = resultadoCompleto.jogosResultado.filter(j => j.totalAcertos >= 13);
    if (jogos13mais.length > 0) {
        setTimeout(() => {
            ModalParabens.mostrar(jogos13mais, resultadoCompleto.concurso);
        }, 600);
    }
}

// Atualizar visual do botão
function atualizarBotaoVisual(botaoElement, resultado) {
    if (!botaoElement) return;
    
    // Remover classes anteriores
    botaoElement.classList.remove('nao-verificado', 'verificado', 'com-premio');
    
    // Adicionar classe baseada no resultado
    botaoElement.classList.add('verificado');
    if (resultado.temPremio) {
        botaoElement.classList.add('com-premio');
    }
    
    // Atualizar status
    const statusElement = botaoElement.querySelector('.teimosinha-status');
    if (statusElement) {
        if (resultado.temPremio) {
            statusElement.className = 'teimosinha-status status-com-premio-btn';
            statusElement.textContent = '🏆 Com prêmio!';
        } else {
            statusElement.className = 'teimosinha-status status-sem-premio';
            statusElement.textContent = '✅ Sem prêmio';
        }
    }
    
    // Atualizar valor
    const valorElement = botaoElement.querySelector('.teimosinha-valor');
    if (valorElement) {
        if (resultado.totalConcurso > 0) {
            valorElement.className = 'teimosinha-valor valor-com-premio';
            valorElement.textContent = `R$ ${resultado.totalConcurso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        } else {
            valorElement.className = 'teimosinha-valor valor-sem-premio';
            valorElement.textContent = 'Sem prêmio';
        }
    }
}

// Atualizar display do total acumulado
function atualizarTotalAcumuladoDisplay() {
    const totalElement = document.getElementById('totalAcumuladoBotoes');
    const contadorElement = document.getElementById('botoesVerificadosCount');
    
    if (totalElement) {
        totalElement.textContent = `R$ ${botoesTeimosinha.totalAcumulado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
    
    if (contadorElement) {
        contadorElement.textContent = botoesTeimosinha.contadorVerificados;
    }
    
    console.log(`📊 Total acumulado atualizado: R$ ${botoesTeimosinha.totalAcumulado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${botoesTeimosinha.contadorVerificados}/24)`);
}

// Limpar total acumulado
function limparTotalAcumulado() {
    console.log('🗑️ Limpando total acumulado...');
    
    botoesTeimosinha.concursosVerificados.clear();
    botoesTeimosinha.totalAcumulado = 0;
    botoesTeimosinha.contadorVerificados = 0;
    
    // Atualizar display
    atualizarTotalAcumuladoDisplay();
    
    // Resetar todos os botões
    document.querySelectorAll('.botao-teimosinha').forEach(botao => {
        if (!botao.classList.contains('futuro')) {
            botao.classList.remove('verificado', 'com-premio');
            botao.classList.add('nao-verificado');
            
            const statusElement = botao.querySelector('.teimosinha-status');
            const valorElement = botao.querySelector('.teimosinha-valor');
            
            if (statusElement) {
                statusElement.className = 'teimosinha-status status-nao-sorteado';
                statusElement.textContent = '🎲 Clique para verificar';
            }
            
            if (valorElement) {
                valorElement.className = 'teimosinha-valor valor-aguardando';
                valorElement.textContent = 'Clique para verificar';
            }
        }
    });
    
    // Ocultar resultado individual
    const resultadoContainer = document.getElementById('resultadoConcursoIndividual');
    if (resultadoContainer) {
        resultadoContainer.style.display = 'none';
    }
}

// Mostrar resultado do concurso individual
function mostrarResultadoConcursoIndividual(resultado) {
    const container = document.getElementById('resultadoConcursoIndividual');
    if (!container) return;
    
    const simuladoText = resultado.simulado ? ' (SIMULAÇÃO)' : '';
    
    container.innerHTML = `
        <h3>📊 RESULTADO DA ${resultado.numero}ª TEIMOSINHA${simuladoText}</h3>
        
        <div class="concurso-resultado-header">
            <div class="concurso-resultado-titulo">Concurso ${resultado.concurso}</div>
            <div class="concurso-resultado-data">${resultado.dia}, ${resultado.data}</div>
        </div>
        
        <div class="concurso-numeros-sorteados">
            ${resultado.numerosSorteados.sort((a, b) => a - b).map(num => 
                `<div class="concurso-numero-bola">${num.toString().padStart(2, '0')}</div>`
            ).join('')}
        </div>
        
        <div class="concurso-jogos-resultado">
            ${resultado.jogosResultado.map(jogo => `
                <div class="concurso-jogo-item ${jogo.temPremio ? 'com-premio' : ''}">
                    <div class="concurso-jogo-header">
                        <span class="concurso-jogo-numero">Jogo ${jogo.numeroJogo}</span>
                        <span class="concurso-jogo-acertos ${jogo.temPremio ? 'com-premio' : ''}">${jogo.totalAcertos} acertos</span>
                    </div>
                    <div class="concurso-jogo-numeros">
                        ${jogo.numeros.map(num => 
                            `<div class="concurso-jogo-numero-item ${jogo.acertos.includes(num) ? 'acertou' : ''}">${num.toString().padStart(2, '0')}</div>`
                        ).join('')}
                    </div>
                    ${jogo.temPremio ? `<div class="concurso-jogo-premio">R$ ${jogo.valorPremio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>` : ''}
                </div>
            `).join('')}
        </div>
        
        <div class="concurso-total-resultado">
            <div class="concurso-total-valor">R$ ${resultado.totalConcurso.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div class="concurso-total-info">Total da ${resultado.numero}ª Teimosinha</div>
        </div>
    `;
    
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Criar dado simulado para teimosinha específica
function criarDadoSimuladoParaTeimosinha(teimosinha) {
    console.log(`🎭 Criando dados simulados para ${teimosinha.numero}ª teimosinha...`);
    
    // Números aleatórios mas que geram alguns acertos
    const numerosPossiveis = [1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const numerosSorteados = [];
    
    // Garantir alguns números que aparecem nos jogos
    const numerosGarantidos = [2, 7, 12, 13, 16, 17, 19, 21]; // Números que aparecem em vários jogos
    numerosSorteados.push(...numerosGarantidos.slice(0, 8));
    
    // Completar com números aleatórios
    while (numerosSorteados.length < 15) {
        const num = numerosPossiveis[Math.floor(Math.random() * numerosPossiveis.length)];
        if (!numerosSorteados.includes(num)) {
            numerosSorteados.push(num);
        }
    }
    
    numerosSorteados.sort((a, b) => a - b);
    
    return {
        ...teimosinha,
        numerosSorteados: numerosSorteados,
        dados: {
            numero: teimosinha.concurso,
            dataApuracao: teimosinha.data,
            valorEstimadoProximoConcurso: 1500000,
            listaDezenas: numerosSorteados.map(n => n.toString().padStart(2, '0')),
            listaRateioPremio: [
                { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 }, // 15 pontos
                { faixa: 2, numeroDeGanhadores: 8, valorPremio: 1500.75 }, // 14 pontos
                { faixa: 3, numeroDeGanhadores: 180, valorPremio: 30 }, // 13 pontos
                { faixa: 4, numeroDeGanhadores: 7800, valorPremio: 12 }, // 12 pontos
                { faixa: 5, numeroDeGanhadores: 98000, valorPremio: 6 } // 11 pontos
            ]
        }
    };
}

// NOTA: Função criarDadoSimuladoParaDia removida (não utilizada)

/* ========================================
   🃏 JOGO DE PACIÊNCIA (KLONDIKE SOLITAIRE)
   ========================================
   
   📚 REGRAS DO JOGO:
   ─────────────────────────────────────────
   • Objetivo: Mover todas as cartas para as 4 fundações
   • Fundações: Empilhar por naipe (Ás → Rei)
   • Tableau: Empilhar decrescente, cores alternadas
   • Monte: Virar 1 carta por vez
   
   🎮 ESTILO CLÁSSICO PC (Windows 98/XP)
   • Drag & Drop com maior espaçamento
   • Desfazer movimento
   • Dica automática
   • Auto-completar
   
   ======================================== */

const JogoPaciencia = {
    // Estado do jogo
    baralho: [],
    monte: [],
    descarte: [],
    fundacoes: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    cartaSelecionada: null,
    origemSelecionada: null,
    movimentos: 0,
    pontos: 0,
    tempo: 0,
    timerInterval: null,
    jogoIniciado: false,
    
    // 📦 Histórico para desfazer
    historico: [],
    maxHistorico: 50,
    
    // 🖱️ Estado do Drag & Drop
    arrastando: false,
    cartasArrastando: [],
    elementoArrastando: null,
    origemArraste: null,
    offsetX: 0,
    offsetY: 0,
    
    // Configuração de espaçamento (MAIOR para cartas mais afastadas)
    ESPACAMENTO_CARTA_FECHADA: 18,
    ESPACAMENTO_CARTA_ABERTA: 32, // Maior espaçamento entre cartas abertas
    
    // Naipes e valores - ESTILO CLÁSSICO (símbolos tradicionais)
    NAIPES: [
        { nome: 'trevo', simbolo: '♣', cor: 'preta' },
        { nome: 'ouro', simbolo: '♦', cor: 'vermelha' },
        { nome: 'copas', simbolo: '♥', cor: 'vermelha' },
        { nome: 'espadas', simbolo: '♠', cor: 'preta' }
    ],
    VALORES: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
    
    // Inicializa o jogo
    init() {
        this.bindEventos();
        this.bindDragDrop();
    },
    
    // Vincula eventos básicos
    bindEventos() {
        // Botão para abrir o jogo
        document.getElementById('btnPaciencia')?.addEventListener('click', () => {
            this.abrirModal();
        });
        
        // Botão para fechar
        document.getElementById('btnFecharPaciencia')?.addEventListener('click', () => {
            this.fecharModal();
        });
        
        // Botão novo jogo
        document.getElementById('btnNovaPaciencia')?.addEventListener('click', () => {
            this.novoJogo();
        });
        
        // Botão desfazer
        document.getElementById('btnDesfazer')?.addEventListener('click', () => {
            this.desfazer();
        });
        
        // Botão dica
        document.getElementById('btnDica')?.addEventListener('click', () => {
            this.mostrarDica();
        });
        
        // Botão auto-completar
        document.getElementById('btnAutoCompletar')?.addEventListener('click', () => {
            this.autoCompletar();
        });
        
        // Botão jogar novamente (vitória)
        document.getElementById('btnJogarNovamente')?.addEventListener('click', () => {
            document.getElementById('pacienciaVitoria').style.display = 'none';
            this.novoJogo();
        });
        
        // Clique no monte
        document.getElementById('monte')?.addEventListener('click', () => {
            this.virarMonte();
        });
    },
    
    // 🖱️ DRAG & DROP - Vincula eventos de arrastar
    bindDragDrop() {
        const mesa = document.getElementById('pacienciaMesa');
        if (!mesa) return;
        
        // Mouse events
        mesa.addEventListener('mousemove', (e) => this.onDrag(e));
        mesa.addEventListener('mouseup', (e) => this.onDragEnd(e));
        mesa.addEventListener('mouseleave', (e) => this.onDragEnd(e));
        
        // Touch events para mobile
        mesa.addEventListener('touchmove', (e) => this.onDrag(e), { passive: false });
        mesa.addEventListener('touchend', (e) => this.onDragEnd(e));
        mesa.addEventListener('touchcancel', (e) => this.onDragEnd(e));
    },
    
    // Inicia o arraste de uma carta
    iniciarArraste(e, origem, index) {
        if (this.arrastando) return;
        
        const posicao = e.touches ? e.touches[0] : e;
        
        // Determina quais cartas serão arrastadas
        if (origem === 'descarte') {
            if (this.descarte.length === 0) return;
            this.cartasArrastando = [this.descarte[this.descarte.length - 1]];
            this.origemArraste = { tipo: 'descarte' };
        } else if (origem.startsWith('tableau-')) {
            const col = parseInt(origem.split('-')[1]);
            if (index >= this.tableau[col].length) return;
            if (!this.tableau[col][index].aberta) return;
            
            // Pega todas as cartas a partir do índice
            this.cartasArrastando = this.tableau[col].slice(index);
            this.origemArraste = { tipo: 'tableau', col, index };
        } else if (origem.startsWith('fundacao-')) {
            const fundIndex = parseInt(origem.split('-')[1]);
            if (this.fundacoes[fundIndex].length === 0) return;
            this.cartasArrastando = [this.fundacoes[fundIndex][this.fundacoes[fundIndex].length - 1]];
            this.origemArraste = { tipo: 'fundacao', index: fundIndex };
        } else {
            return;
        }
        
        this.arrastando = true;
        
        // Cria elemento visual para arraste
        this.criarElementoArraste(posicao.clientX, posicao.clientY);
        
        // Marca cartas originais como fantasma
        this.marcarCartasFantasma(true);
        
        e.preventDefault();
    },
    
    // Cria o elemento visual que segue o mouse
    criarElementoArraste(x, y) {
        const container = document.createElement('div');
        container.id = 'arraste-container';
        container.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 10000;
            left: ${x - 32}px;
            top: ${y - 10}px;
        `;
        
        this.cartasArrastando.forEach((carta, i) => {
            const cartaEl = document.createElement('div');
            cartaEl.className = `carta ${carta.naipe.cor} arrastando`;
            cartaEl.style.cssText = `
                position: absolute;
                top: ${i * this.ESPACAMENTO_CARTA_ABERTA}px;
                left: 0;
                width: 65px;
                height: 90px;
            `;
            cartaEl.innerHTML = `
                <div class="carta-frente">
                    <div class="carta-valor">${carta.valor}${carta.naipe.simbolo}</div>
                    <div class="carta-naipe-centro">${carta.naipe.simbolo}</div>
                    <div class="carta-valor carta-valor-baixo">${carta.valor}${carta.naipe.simbolo}</div>
                </div>
            `;
            container.appendChild(cartaEl);
        });
        
        document.body.appendChild(container);
        this.elementoArrastando = container;
    },
    
    // Move o elemento durante o arraste
    onDrag(e) {
        if (!this.arrastando || !this.elementoArrastando) return;
        
        const posicao = e.touches ? e.touches[0] : e;
        this.elementoArrastando.style.left = `${posicao.clientX - 32}px`;
        this.elementoArrastando.style.top = `${posicao.clientY - 10}px`;
        
        // Destaca destinos válidos
        this.destacarDestinosValidos(posicao.clientX, posicao.clientY);
        
        e.preventDefault();
    },
    
    // Finaliza o arraste
    onDragEnd(e) {
        if (!this.arrastando) return;
        
        const posicao = e.changedTouches ? e.changedTouches[0] : e;
        
        // Encontra o destino
        const destino = this.encontrarDestino(posicao.clientX, posicao.clientY);
        
        if (destino && this.tentarMoverArraste(destino)) {
            // Movimento bem-sucedido
            this.movimentos++;
            this.verificarVitoria();
        }
        
        // Limpa o arraste
        this.limparArraste();
        this.atualizarInterface();
    },
    
    // Encontra o elemento de destino
    encontrarDestino(x, y) {
        // Remove temporariamente o elemento de arraste para encontrar o que está embaixo
        if (this.elementoArrastando) {
            this.elementoArrastando.style.display = 'none';
        }
        
        const elemento = document.elementFromPoint(x, y);
        
        if (this.elementoArrastando) {
            this.elementoArrastando.style.display = '';
        }
        
        if (!elemento) return null;
        
        // Verifica se é uma fundação
        const fundacao = elemento.closest('.fundacao');
        if (fundacao) {
            return fundacao.id;
        }
        
        // Verifica se é uma coluna do tableau
        const coluna = elemento.closest('.tableau-coluna');
        if (coluna) {
            return coluna.id;
        }
        
        // Verifica se é uma carta no tableau
        const carta = elemento.closest('.carta');
        if (carta) {
            const colunaParent = carta.closest('.tableau-coluna');
            if (colunaParent) {
                return colunaParent.id;
            }
        }
        
        return null;
    },
    
    // Tenta mover as cartas arrastadas para o destino
    tentarMoverArraste(destino) {
        const cartaPrincipal = this.cartasArrastando[0];
        const origem = this.origemArraste;
        
        // Salva estado para desfazer
        this.salvarEstado();
        
        // Mover para fundação
        if (destino.startsWith('fundacao-')) {
            const fundIndex = parseInt(destino.split('-')[1]);
            
            // Só pode mover uma carta por vez para fundação
            if (this.cartasArrastando.length !== 1) return false;
            
            if (this.podeMoverParaFundacao(cartaPrincipal, fundIndex)) {
                this.removerCartaDaOrigem(origem);
                this.fundacoes[fundIndex].push(cartaPrincipal);
                this.pontos += 15;
                return true;
            }
        }
        
        // Mover para tableau
        if (destino.startsWith('tableau-')) {
            const colDestino = parseInt(destino.split('-')[1]);
            
            if (this.podeMoverParaTableau(cartaPrincipal, colDestino)) {
                this.removerCartaDaOrigem(origem);
                this.tableau[colDestino].push(...this.cartasArrastando);
                this.pontos += 5;
                return true;
            }
        }
        
        // Movimento inválido - remove o estado salvo
        this.historico.pop();
        return false;
    },
    
    // Remove carta(s) da origem
    removerCartaDaOrigem(origem) {
        if (origem.tipo === 'descarte') {
            this.descarte.pop();
        } else if (origem.tipo === 'tableau') {
            this.tableau[origem.col].splice(origem.index);
            this.abrirUltimaCartaTableau(origem.col);
        } else if (origem.tipo === 'fundacao') {
            this.fundacoes[origem.index].pop();
        }
    },
    
    // Marca cartas como fantasma durante arraste
    marcarCartasFantasma(fantasma) {
        // Implementação opcional para efeito visual
    },
    
    // Destaca destinos válidos
    destacarDestinosValidos(x, y) {
        // Remove destaques anteriores
        document.querySelectorAll('.destino-valido').forEach(el => {
            el.classList.remove('destino-valido');
        });
        
        const cartaPrincipal = this.cartasArrastando[0];
        if (!cartaPrincipal) return;
        
        // Destaca fundações válidas (só se for 1 carta)
        if (this.cartasArrastando.length === 1) {
            for (let i = 0; i < 4; i++) {
                if (this.podeMoverParaFundacao(cartaPrincipal, i)) {
                    document.getElementById(`fundacao-${i}`)?.classList.add('destino-valido');
                }
            }
        }
        
        // Destaca colunas válidas do tableau
        for (let i = 0; i < 7; i++) {
            if (this.podeMoverParaTableau(cartaPrincipal, i)) {
                document.getElementById(`tableau-${i}`)?.classList.add('destino-valido');
            }
        }
    },
    
    // Limpa o estado de arraste
    limparArraste() {
        this.arrastando = false;
        this.cartasArrastando = [];
        this.origemArraste = null;
        
        if (this.elementoArrastando) {
            this.elementoArrastando.remove();
            this.elementoArrastando = null;
        }
        
        // Remove destaques
        document.querySelectorAll('.destino-valido').forEach(el => {
            el.classList.remove('destino-valido');
        });
        document.querySelectorAll('.arrastar-fantasma').forEach(el => {
            el.classList.remove('arrastar-fantasma');
        });
    },
    
    // 📦 HISTÓRICO - Salva estado para desfazer
    salvarEstado() {
        const estado = {
            monte: JSON.parse(JSON.stringify(this.monte)),
            descarte: JSON.parse(JSON.stringify(this.descarte)),
            fundacoes: JSON.parse(JSON.stringify(this.fundacoes)),
            tableau: JSON.parse(JSON.stringify(this.tableau)),
            pontos: this.pontos,
            movimentos: this.movimentos
        };
        
        this.historico.push(estado);
        
        // Limita o histórico
        if (this.historico.length > this.maxHistorico) {
            this.historico.shift();
        }
    },
    
    // ↩️ DESFAZER - Volta ao estado anterior
    desfazer() {
        if (this.historico.length === 0) {
            this.mostrarMensagem('Nenhum movimento para desfazer!');
            return;
        }
        
        const estado = this.historico.pop();
        
        this.monte = estado.monte;
        this.descarte = estado.descarte;
        this.fundacoes = estado.fundacoes;
        this.tableau = estado.tableau;
        this.pontos = Math.max(0, estado.pontos - 10); // Penalidade por desfazer
        this.movimentos = estado.movimentos;
        
        this.atualizarInterface();
        this.mostrarMensagem('Movimento desfeito!');
    },
    
    // 💡 DICA - Mostra um movimento possível
    mostrarDica() {
        // Procura primeiro nas cartas do descarte
        if (this.descarte.length > 0) {
            const carta = this.descarte[this.descarte.length - 1];
            
            // Tenta fundação
            for (let i = 0; i < 4; i++) {
                if (this.podeMoverParaFundacao(carta, i)) {
                    this.destacarDica('descarte', `fundacao-${i}`);
                    this.pontos = Math.max(0, this.pontos - 5);
                    return;
                }
            }
            
            // Tenta tableau
            for (let i = 0; i < 7; i++) {
                if (this.podeMoverParaTableau(carta, i)) {
                    this.destacarDica('descarte', `tableau-${i}`);
                    this.pontos = Math.max(0, this.pontos - 5);
                    return;
                }
            }
        }
        
        // Procura no tableau
        for (let col = 0; col < 7; col++) {
            const coluna = this.tableau[col];
            for (let i = 0; i < coluna.length; i++) {
                if (!coluna[i].aberta) continue;
                const carta = coluna[i];
                
                // Tenta fundação (só a última carta)
                if (i === coluna.length - 1) {
                    for (let f = 0; f < 4; f++) {
                        if (this.podeMoverParaFundacao(carta, f)) {
                            this.destacarDica(`tableau-${col}`, `fundacao-${f}`);
                            this.pontos = Math.max(0, this.pontos - 5);
                            return;
                        }
                    }
                }
                
                // Tenta tableau
                for (let destCol = 0; destCol < 7; destCol++) {
                    if (destCol === col) continue;
                    if (this.podeMoverParaTableau(carta, destCol)) {
                        this.destacarDica(`tableau-${col}`, `tableau-${destCol}`);
                        this.pontos = Math.max(0, this.pontos - 5);
                        return;
                    }
                }
            }
        }
        
        // Se tem cartas no monte, sugere virar
        if (this.monte.length > 0) {
            this.destacarDica('monte', null);
            this.mostrarMensagem('💡 Dica: Vire uma carta do monte!');
            return;
        }
        
        this.mostrarMensagem('Nenhuma dica disponível!');
    },
    
    // Destaca elementos da dica
    destacarDica(origem, destino) {
        const origemEl = document.getElementById(origem);
        const destinoEl = destino ? document.getElementById(destino) : null;
        
        if (origemEl) {
            origemEl.classList.add('dica-origem');
            setTimeout(() => origemEl.classList.remove('dica-origem'), 2000);
        }
        
        if (destinoEl) {
            destinoEl.classList.add('dica-destino');
            setTimeout(() => destinoEl.classList.remove('dica-destino'), 2000);
        }
        
        this.mostrarMensagem('💡 Dica: Mova a carta destacada!');
    },
    
    // 🚀 AUTO-COMPLETAR - Move todas as cartas possíveis para fundações
    autoCompletar() {
        // Verifica se todas as cartas estão reveladas
        let todasReveladas = true;
        for (let col = 0; col < 7; col++) {
            for (let carta of this.tableau[col]) {
                if (!carta.aberta) {
                    todasReveladas = false;
                    break;
                }
            }
        }
        
        if (!todasReveladas && this.monte.length > 0) {
            this.mostrarMensagem('Revele todas as cartas primeiro!');
            return;
        }
        
        let moveu = true;
        let totalMovimentos = 0;
        
        while (moveu) {
            moveu = false;
            
            // Tenta mover do descarte
            if (this.descarte.length > 0) {
                const carta = this.descarte[this.descarte.length - 1];
                for (let i = 0; i < 4; i++) {
                    if (this.podeMoverParaFundacao(carta, i)) {
                        this.salvarEstado();
                        this.descarte.pop();
                        this.fundacoes[i].push(carta);
                        this.pontos += 15;
                        this.movimentos++;
                        totalMovimentos++;
                        moveu = true;
                        break;
                    }
                }
            }
            
            // Tenta mover do tableau
            for (let col = 0; col < 7; col++) {
                const coluna = this.tableau[col];
                if (coluna.length === 0) continue;
                
                const carta = coluna[coluna.length - 1];
                if (!carta.aberta) continue;
                
                for (let i = 0; i < 4; i++) {
                    if (this.podeMoverParaFundacao(carta, i)) {
                        this.salvarEstado();
                        coluna.pop();
                        this.fundacoes[i].push(carta);
                        this.abrirUltimaCartaTableau(col);
                        this.pontos += 15;
                        this.movimentos++;
                        totalMovimentos++;
                        moveu = true;
                        break;
                    }
                }
                if (moveu) break;
            }
        }
        
        this.atualizarInterface();
        
        if (totalMovimentos > 0) {
            this.mostrarMensagem(`🚀 ${totalMovimentos} cartas movidas automaticamente!`);
            this.verificarVitoria();
        } else {
            this.mostrarMensagem('Nenhuma carta pode ser movida!');
        }
    },
    
    // Mostra mensagem temporária
    mostrarMensagem(texto) {
        let msg = document.getElementById('pacienciaMensagem');
        if (!msg) {
            msg = document.createElement('div');
            msg.id = 'pacienciaMensagem';
            msg.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #000080;
                color: #fff;
                padding: 15px 25px;
                border: 2px solid;
                border-color: #fff #808080 #808080 #fff;
                font-family: "Tahoma", sans-serif;
                font-size: 14px;
                z-index: 100000;
                box-shadow: 3px 3px 10px rgba(0, 0, 0, 0.5);
            `;
            document.body.appendChild(msg);
        }
        
        msg.textContent = texto;
        msg.style.display = 'block';
        
        setTimeout(() => {
            msg.style.display = 'none';
        }, 2000);
    },
    
    // Abre o modal do jogo
    abrirModal() {
        const modal = document.getElementById('pacienciaModal');
        modal.classList.add('ativo');
        this.novoJogo();
    },
    
    // Fecha o modal
    fecharModal() {
        const modal = document.getElementById('pacienciaModal');
        modal.classList.remove('ativo');
        this.pararTimer();
        this.limparArraste();
    },
    
    // Inicia um novo jogo
    novoJogo() {
        // Reset estado
        this.monte = [];
        this.descarte = [];
        this.fundacoes = [[], [], [], []];
        this.tableau = [[], [], [], [], [], [], []];
        this.cartaSelecionada = null;
        this.origemSelecionada = null;
        this.movimentos = 0;
        this.pontos = 0;
        this.tempo = 0;
        this.jogoIniciado = true;
        this.historico = [];
        
        // Limpa qualquer arraste pendente
        this.limparArraste();
        
        // Esconde vitória
        document.getElementById('pacienciaVitoria').style.display = 'none';
        
        // Cria e embaralha o baralho
        this.criarBaralho();
        this.embaralhar();
        
        // Distribui as cartas
        this.distribuirCartas();
        
        // Atualiza interface
        this.atualizarInterface();
        
        // Inicia timer
        this.iniciarTimer();
    },
    
    // Cria um baralho de 52 cartas
    criarBaralho() {
        this.baralho = [];
        
        for (let naipeIndex = 0; naipeIndex < this.NAIPES.length; naipeIndex++) {
            for (let valorIndex = 0; valorIndex < this.VALORES.length; valorIndex++) {
                this.baralho.push({
                    naipe: this.NAIPES[naipeIndex],
                    valor: this.VALORES[valorIndex],
                    valorNumerico: valorIndex,
                    aberta: false
                });
            }
        }
    },
    
    // Embaralha o baralho (Fisher-Yates)
    embaralhar() {
        for (let i = this.baralho.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.baralho[i], this.baralho[j]] = [this.baralho[j], this.baralho[i]];
        }
    },
    
    // Distribui cartas para o tableau
    distribuirCartas() {
        let cartaIndex = 0;
        
        // Distribui para as 7 colunas do tableau
        for (let col = 0; col < 7; col++) {
            for (let row = 0; row <= col; row++) {
                const carta = this.baralho[cartaIndex++];
                carta.aberta = (row === col); // Só a última carta fica aberta
                this.tableau[col].push(carta);
            }
        }
        
        // Resto vai para o monte
        while (cartaIndex < this.baralho.length) {
            this.monte.push(this.baralho[cartaIndex++]);
        }
    },
    
    // Vira uma carta do monte
    virarMonte() {
        if (this.monte.length > 0) {
            const carta = this.monte.pop();
            carta.aberta = true;
            this.descarte.push(carta);
            this.pontos = Math.max(0, this.pontos - 5);
        } else if (this.descarte.length > 0) {
            // Recicla o descarte para o monte
            while (this.descarte.length > 0) {
                const carta = this.descarte.pop();
                carta.aberta = false;
                this.monte.push(carta);
            }
            this.pontos = Math.max(0, this.pontos - 20);
        }
        
        this.atualizarInterface();
    },
    
    // Verifica se pode mover carta para fundação
    podeMoverParaFundacao(carta, fundacaoIndex) {
        const fundacao = this.fundacoes[fundacaoIndex];
        const naipeFundacao = this.NAIPES[fundacaoIndex].nome;
        
        if (carta.naipe.nome !== naipeFundacao) return false;
        
        if (fundacao.length === 0) {
            return carta.valor === 'A';
        }
        
        const cartaTopo = fundacao[fundacao.length - 1];
        return carta.valorNumerico === cartaTopo.valorNumerico + 1;
    },
    
    // Verifica se pode mover carta para tableau
    podeMoverParaTableau(carta, colunaIndex) {
        const coluna = this.tableau[colunaIndex];
        
        if (coluna.length === 0) {
            return carta.valor === 'K';
        }
        
        const cartaTopo = coluna[coluna.length - 1];
        
        // Cores diferentes e valor decrescente
        const corDiferente = this.corDiferente(carta, cartaTopo);
        const valorCorreto = carta.valorNumerico === cartaTopo.valorNumerico - 1;
        
        return corDiferente && valorCorreto && cartaTopo.aberta;
    },
    
    // Verifica se as cores são diferentes (preto vs vermelho)
    corDiferente(carta1, carta2) {
        const cor1 = carta1.naipe.cor;
        const cor2 = carta2.naipe.cor;
        
        // Preto (trevo, espadas) vs Vermelho (ouro, copas)
        return cor1 !== cor2;
    },
    
    // Seleciona uma carta
    selecionarCarta(origem, index) {
        // Se já tem carta selecionada, tenta mover
        if (this.cartaSelecionada) {
            this.tentarMover(origem, index);
            return;
        }
        
        let carta = null;
        
        if (origem === 'descarte' && this.descarte.length > 0) {
            carta = this.descarte[this.descarte.length - 1];
            this.origemSelecionada = { tipo: 'descarte' };
        } else if (origem.startsWith('tableau-')) {
            const col = parseInt(origem.split('-')[1]);
            if (index < this.tableau[col].length && this.tableau[col][index].aberta) {
                carta = this.tableau[col][index];
                this.origemSelecionada = { tipo: 'tableau', col, index };
            }
        } else if (origem.startsWith('fundacao-')) {
            const fundIndex = parseInt(origem.split('-')[1]);
            if (this.fundacoes[fundIndex].length > 0) {
                carta = this.fundacoes[fundIndex][this.fundacoes[fundIndex].length - 1];
                this.origemSelecionada = { tipo: 'fundacao', index: fundIndex };
            }
        }
        
        if (carta) {
            this.cartaSelecionada = carta;
            this.atualizarInterface();
        }
    },
    
    // Tenta mover carta selecionada
    tentarMover(destino, index) {
        const carta = this.cartaSelecionada;
        const origem = this.origemSelecionada;
        let moveu = false;
        
        // Mover para fundação
        if (destino.startsWith('fundacao-')) {
            const fundIndex = parseInt(destino.split('-')[1]);
            
            if (origem.tipo === 'tableau' && origem.index === this.tableau[origem.col].length - 1) {
                if (this.podeMoverParaFundacao(carta, fundIndex)) {
                    this.tableau[origem.col].pop();
                    this.fundacoes[fundIndex].push(carta);
                    this.abrirUltimaCartaTableau(origem.col);
                    this.pontos += 15;
                    moveu = true;
                }
            } else if (origem.tipo === 'descarte') {
                if (this.podeMoverParaFundacao(carta, fundIndex)) {
                    this.descarte.pop();
                    this.fundacoes[fundIndex].push(carta);
                    this.pontos += 15;
                    moveu = true;
                }
            }
        }
        
        // Mover para tableau
        if (destino.startsWith('tableau-')) {
            const colDestino = parseInt(destino.split('-')[1]);
            
            if (this.podeMoverParaTableau(carta, colDestino)) {
                if (origem.tipo === 'tableau') {
                    // Move múltiplas cartas
                    const cartasParaMover = this.tableau[origem.col].splice(origem.index);
                    this.tableau[colDestino].push(...cartasParaMover);
                    this.abrirUltimaCartaTableau(origem.col);
                    this.pontos += 5;
                    moveu = true;
                } else if (origem.tipo === 'descarte') {
                    this.descarte.pop();
                    this.tableau[colDestino].push(carta);
                    this.pontos += 5;
                    moveu = true;
                } else if (origem.tipo === 'fundacao') {
                    this.fundacoes[origem.index].pop();
                    this.tableau[colDestino].push(carta);
                    this.pontos = Math.max(0, this.pontos - 10);
                    moveu = true;
                }
            }
        }
        
        if (moveu) {
            this.movimentos++;
            this.verificarVitoria();
        }
        
        // Limpa seleção
        this.cartaSelecionada = null;
        this.origemSelecionada = null;
        this.atualizarInterface();
    },
    
    // Abre a última carta do tableau se estiver fechada
    abrirUltimaCartaTableau(col) {
        const coluna = this.tableau[col];
        if (coluna.length > 0 && !coluna[coluna.length - 1].aberta) {
            coluna[coluna.length - 1].aberta = true;
            this.pontos += 5;
        }
    },
    
    // Duplo clique - move automaticamente para fundação
    autoMover(origem, index) {
        let carta = null;
        let origemObj = null;
        
        if (origem === 'descarte' && this.descarte.length > 0) {
            carta = this.descarte[this.descarte.length - 1];
            origemObj = { tipo: 'descarte' };
        } else if (origem.startsWith('tableau-')) {
            const col = parseInt(origem.split('-')[1]);
            const coluna = this.tableau[col];
            if (index === coluna.length - 1 && coluna[index]?.aberta) {
                carta = coluna[index];
                origemObj = { tipo: 'tableau', col };
            }
        }
        
        if (!carta) return;
        
        // Tenta mover para fundação
        for (let i = 0; i < 4; i++) {
            if (this.podeMoverParaFundacao(carta, i)) {
                if (origemObj.tipo === 'tableau') {
                    this.tableau[origemObj.col].pop();
                    this.abrirUltimaCartaTableau(origemObj.col);
                } else {
                    this.descarte.pop();
                }
                this.fundacoes[i].push(carta);
                this.movimentos++;
                this.pontos += 15;
                this.verificarVitoria();
                this.atualizarInterface();
                return;
            }
        }
    },
    
    // Verifica vitória
    verificarVitoria() {
        const totalFundacoes = this.fundacoes.reduce((acc, f) => acc + f.length, 0);
        
        if (totalFundacoes === 52) {
            this.pararTimer();
            this.mostrarVitoria();
        }
    },
    
    // Mostra tela de vitória
    mostrarVitoria() {
        const stats = document.getElementById('vitoriaStats');
        const minutos = Math.floor(this.tempo / 60);
        const segundos = this.tempo % 60;
        
        stats.innerHTML = `
            <p>⏱️ Tempo: ${minutos}:${segundos.toString().padStart(2, '0')}</p>
            <p>🎯 Movimentos: ${this.movimentos}</p>
            <p>⭐ Pontuação: ${this.pontos}</p>
        `;
        
        document.getElementById('pacienciaVitoria').style.display = 'flex';
        
        // Animação de vitória nas cartas
        document.querySelectorAll('.carta').forEach((carta, i) => {
            setTimeout(() => {
                carta.classList.add('vitoria');
            }, i * 50);
        });
    },
    
    // Timer
    iniciarTimer() {
        this.pararTimer();
        this.tempo = 0;
        
        this.timerInterval = setInterval(() => {
            this.tempo++;
            this.atualizarTimer();
        }, 1000);
    },
    
    pararTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    },
    
    atualizarTimer() {
        const minutos = Math.floor(this.tempo / 60);
        const segundos = this.tempo % 60;
        document.getElementById('pacienciaTempo').textContent = 
            `Tempo: ${minutos}:${segundos.toString().padStart(2, '0')}`;
    },
    
    // Atualiza toda a interface
    atualizarInterface() {
        this.renderizarMonte();
        this.renderizarDescarte();
        this.renderizarFundacoes();
        this.renderizarTableau();
        
        document.getElementById('pacienciaMovimentos').textContent = `Movimentos: ${this.movimentos}`;
        document.getElementById('pacienciaPontos').textContent = `Pontos: ${this.pontos}`;
    },
    
    // Renderiza o monte
    renderizarMonte() {
        const monteEl = document.getElementById('monte');
        if (this.monte.length === 0) {
            monteEl.innerHTML = '<span style="font-size: 24px; opacity: 0.3;">🔄</span>';
            monteEl.style.cursor = this.descarte.length > 0 ? 'pointer' : 'default';
        } else {
            monteEl.innerHTML = '';
            // Mostra algumas cartas empilhadas
            const mostrar = Math.min(3, this.monte.length);
            for (let i = 0; i < mostrar; i++) {
                const cartaEl = document.createElement('div');
                cartaEl.className = 'carta fechada';
                cartaEl.style.cssText = `
                    position: absolute;
                    top: ${i * 2}px;
                    left: ${i * 2}px;
                `;
                cartaEl.innerHTML = `
                    <div class="carta-frente"></div>
                    <div class="carta-verso"></div>
                `;
                monteEl.appendChild(cartaEl);
            }
        }
    },
    
    // Renderiza o descarte
    renderizarDescarte() {
        const descarteEl = document.getElementById('descarte');
        descarteEl.innerHTML = '';
        
        if (this.descarte.length > 0) {
            const carta = this.descarte[this.descarte.length - 1];
            const cartaEl = this.criarElementoCarta(carta, 'descarte', this.descarte.length - 1);
            cartaEl.style.position = 'absolute';
            cartaEl.style.top = '0';
            cartaEl.style.left = '0';
            descarteEl.appendChild(cartaEl);
        }
    },
    
    // Renderiza as fundações
    renderizarFundacoes() {
        for (let i = 0; i < 4; i++) {
            const fundEl = document.getElementById(`fundacao-${i}`);
            const fundacao = this.fundacoes[i];
            
            // Mantém o ::before com o símbolo do naipe
            fundEl.innerHTML = '';
            
            if (fundacao.length > 0) {
                const carta = fundacao[fundacao.length - 1];
                const cartaEl = this.criarElementoCarta(carta, `fundacao-${i}`, fundacao.length - 1);
                cartaEl.style.position = 'absolute';
                cartaEl.style.top = '0';
                cartaEl.style.left = '0';
                fundEl.appendChild(cartaEl);
            }
            
            // Clique para mover para fundação
            fundEl.onclick = () => {
                if (this.cartaSelecionada) {
                    this.tentarMover(`fundacao-${i}`, 0);
                }
            };
        }
    },
    
    // Renderiza o tableau com maior espaçamento
    renderizarTableau() {
        for (let col = 0; col < 7; col++) {
            const colunaEl = document.getElementById(`tableau-${col}`);
            colunaEl.innerHTML = '';
            
            const coluna = this.tableau[col];
            let offsetTop = 0;
            
            coluna.forEach((carta, index) => {
                const cartaEl = this.criarElementoCarta(carta, `tableau-${col}`, index);
                cartaEl.style.position = 'absolute';
                cartaEl.style.top = `${offsetTop}px`;
                cartaEl.style.left = '0';
                cartaEl.style.zIndex = index;
                
                // 🎯 MAIOR ESPAÇAMENTO: cartas abertas ficam mais afastadas
                if (carta.aberta) {
                    offsetTop += this.ESPACAMENTO_CARTA_ABERTA;
                } else {
                    offsetTop += this.ESPACAMENTO_CARTA_FECHADA;
                }
                
                colunaEl.appendChild(cartaEl);
            });
            
            // Atualiza altura mínima da coluna
            colunaEl.style.minHeight = `${offsetTop + 90}px`;
            
            // Clique em coluna vazia
            if (coluna.length === 0) {
                colunaEl.onclick = () => {
                    if (this.cartaSelecionada) {
                        this.tentarMover(`tableau-${col}`, 0);
                    }
                };
            }
        }
    },
    
    // Cria elemento HTML da carta com Drag & Drop
    criarElementoCarta(carta, origem, index) {
        const div = document.createElement('div');
        const corClasse = carta.naipe.cor;
        const selecionada = this.cartaSelecionada === carta;
        
        div.className = `carta ${corClasse} ${carta.aberta ? '' : 'fechada'} ${selecionada ? 'selecionada' : ''}`;
        
        div.innerHTML = `
            <div class="carta-frente">
                <div class="carta-valor">${carta.valor}${carta.naipe.simbolo}</div>
                <div class="carta-naipe-centro">${carta.naipe.simbolo}</div>
                <div class="carta-valor carta-valor-baixo">${carta.valor}${carta.naipe.simbolo}</div>
            </div>
            <div class="carta-verso"></div>
        `;
        
        // Eventos
        if (carta.aberta) {
            // Clique
            div.onclick = (e) => {
                e.stopPropagation();
                this.selecionarCarta(origem, index);
            };
            
            // Duplo clique - auto mover
            div.ondblclick = (e) => {
                e.stopPropagation();
                this.autoMover(origem, index);
            };
            
            // 🖱️ DRAG & DROP - Mouse
            div.onmousedown = (e) => {
                if (e.button === 0) { // Botão esquerdo
                    this.iniciarArraste(e, origem, index);
                }
            };
            
            // 🖱️ DRAG & DROP - Touch
            div.ontouchstart = (e) => {
                this.iniciarArraste(e, origem, index);
            };
            
            div.style.cursor = 'grab';
        }
        
        return div;
    }
};

// Inicializa o jogo quando o DOM carregar
document.addEventListener('DOMContentLoaded', () => {
    JogoPaciencia.init();
});