/**
 * ARQUIVO PRINCIPAL
 * Inicialização e entrada da aplicação
 */

/**
 * Inicializa a aplicação quando o DOM está pronto
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Inicializando aplicação...');
    console.log('Versão: 2.0 (Modular)');
    console.log('Data:', new Date().toLocaleString('pt-BR'));
    
    // Adicionar CSS das animações
    adicionarEstilosDinamicos();

    // Tema claro/escuro
    configurarTema();

    // Mostrar/esconder valores do dashboard (olho — no lugar onde era o tema)
    configurarOlhoValores();

    // Reserva a faixa da barra de rolagem só quando ela existe de fato
    configurarGutterScroll();

    // Configurar event listeners
    configurarEventListeners();

    // Exigir login (magic link). Sem sessão, mostra a tela de acesso e para aqui.
    const autenticado = await initAuth();
    if (!autenticado) {
        console.log('🔒 Aguardando login...');
        return;
    }

    // Carregar menus (categorias, métodos, recorrências)
    console.log('📑 Carregando menus...');
    await carregarMenus();

    // Feriados (nacionais calculados + do usuário) — usados no cálculo de dia útil
    if (typeof carregarFeriados === 'function') {
        try { await carregarFeriados(); } catch (e) { console.warn('Feriados:', e); }
    }

    // Estado inicial do formulário
    const dataInput = document.querySelector(SELECTORS.data);
    if (dataInput && !dataInput.value) aplicarDataPadrao(true);
    atualizarCampoParcelas();
    atualizarCampoCredito();
    atualizarLabelsPorTipo();

    // Carregar dados iniciais
    console.log('📊 Carregando dados...');
    await carregarDados();
    if (typeof iniciarVisaoAnual === 'function' && !window._anualIniciado) { window._anualIniciado = true; iniciarVisaoAnual(); }
    if (typeof carregarSaldoContas === 'function') carregarSaldoContas();
    if (typeof carregarFaturasBanco === 'function') carregarFaturasBanco();
    // Já mostra o último saldo guardado e, em seguida, busca o atual na Pluggy
    if (typeof atualizarSaldosPluggy === 'function') {
        atualizarSaldosPluggy(true);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') atualizarSaldosPluggy();
        });
    }
    if (typeof carregarConciliadas === 'function') carregarConciliadas().then(() => atualizarUI());

    // Atualizar UI
    atualizarUI();

    // Resumo compacto fixo (aparece ao rolar além do dashboard)
    configurarMiniResumo();

    console.log('✓ Aplicação iniciada com sucesso!');
    console.log('Estado:', estadoApp);
});

/**
 * Reserva a faixa da barra de rolagem (scrollbar-gutter) só quando o
 * conteúdo do <main> realmente precisa rolar. Fixo no CSS (sempre
 * reservado) deixava uma faixa vazia sobrando à direita da tela toda vez
 * que o conteúdo cabia sem rolar — que é a maioria das telas, já que o
 * dashboard é curto. A classe no <html> liga o scrollbar-gutter (ver
 * css/layout.css) só quando main.scrollHeight excede sua altura visível.
 */
function configurarGutterScroll() {
    const main = document.querySelector('main.main');
    if (!main) return;

    const sincronizar = () => {
        const temScroll = main.scrollHeight > main.clientHeight + 1;
        document.documentElement.classList.toggle('tem-scroll-conteudo', temScroll);
    };

    sincronizar();
    new ResizeObserver(sincronizar).observe(main);
    new MutationObserver(sincronizar).observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', sincronizar);
}

/**
 * Mostra a barra de resumo compacto quando o card "Gasto diário" sai da tela
 * por cima (usuário rolou para além do dashboard).
 */
function configurarMiniResumo() {
    const alvo = document.querySelector('.summary-card.gasto-diario');
    const ref = document.querySelector('.month-bar');   // fundo da barra fixa (não muda ao abrir o mini)
    const mini = document.getElementById('miniResumo');
    const btnLanc = document.querySelector('.tabs [data-tab="adicionar"]');
    const linha2 = document.querySelector('.mini-linha2');
    const miniLanc = document.getElementById('miniLancamento');
    const miniProximos = document.getElementById('miniProximos');
    const miniEntradas = document.querySelector('.mini-box.entradas');
    const miniSaidas = document.querySelector('.mini-box.saidas');
    if (!alvo || !ref || !mini) return;

    // Caixas de Receita/Despesa: mesmo toggle dos cards do dashboard
    if (miniEntradas) miniEntradas.addEventListener('click', () => {
        if (typeof mudarAba === 'function') mudarAba('entradas');
    });
    if (miniSaidas) miniSaidas.addEventListener('click', () => {
        if (typeof mudarAba === 'function') mudarAba('saidas');
    });

    // "+ Lançamento" na 2ª linha da barra: abre o formulário
    if (miniLanc) miniLanc.addEventListener('click', () => {
        if (typeof mudarAba === 'function') mudarAba('adicionar');
        const form = document.getElementById('adicionar');
        if (form) {
            form.scrollIntoView({ block: 'start' });
            const topo = document.querySelector('.topo');
            if (topo) window.scrollBy(0, -(topo.offsetHeight + 8));
        }
    });

    // "Próximos" na 2ª linha da barra: abre a aba de próximos lançamentos
    if (miniProximos) miniProximos.addEventListener('click', () => {
        if (typeof mudarAba === 'function') mudarAba('proximas');
    });
    // Lixeira (emoji) — divide com "Próximos" a coluna do "Gasto diário"
    document.getElementById('miniLixeira')?.addEventListener('click', () => {
        if (typeof mudarAba === 'function') mudarAba('lixeira');
    });

    // Limite em scrollY (não em getBoundingClientRect ao vivo) — mostrar o
    // mini engorda a barra fixa (".topo" fica mais alta), o que empurra
    // TODO o conteúdo de baixo (inclusive o próprio "alvo") pra baixo; se a
    // decisão de mostrar/esconder reagir a essa medida ao vivo, o mini
    // pisca sem parar bem no limite (mostra -> empurra o card pra baixo ->
    // "não passou mais" -> esconde -> volta pro lugar -> "passou nte" ->
    // mostra de novo...). Em vez disso, mede a distância só enquanto o
    // mini está ESCONDIDO (estado "neutro", sem essa auto-interferência) e
    // reusa esse número até esconder de novo; some histerese (não é o
    // mesmo scrollY pra mostrar e pra esconder) pra folgar a borda.
    let raf = 0;
    let limiteMini = null;
    let limiteLinha2 = null;
    const HISTERESE = 16;

    const avaliar = () => {
        raf = 0;
        if (mini.hidden) {
            const fundoBarra = ref.getBoundingClientRect().bottom;
            limiteMini = window.scrollY + (alvo.getBoundingClientRect().bottom - fundoBarra);
            if (btnLanc) limiteLinha2 = window.scrollY + (btnLanc.getBoundingClientRect().bottom - fundoBarra);
        }
        if (limiteMini != null) {
            const mostrar = window.scrollY >= limiteMini + HISTERESE;
            const esconder = window.scrollY <= limiteMini - HISTERESE;
            if (mostrar && mini.hidden) mini.hidden = false;
            else if (esconder && !mini.hidden) mini.hidden = true;
        }
        // 2ª linha: aparece quando o botão "+ Lançamento" também sai de vista
        if (btnLanc && linha2 && limiteLinha2 != null) {
            const mostrarLinha2 = window.scrollY >= limiteLinha2 + HISTERESE;
            const esconderLinha2 = window.scrollY <= limiteLinha2 - HISTERESE;
            if (mostrarLinha2 && linha2.hidden) linha2.hidden = false;
            else if (esconderLinha2 && !linha2.hidden) linha2.hidden = true;
        }
    };
    const agendar = () => { if (!raf) raf = requestAnimationFrame(avaliar); };
    // Resize pode mudar onde os cards caem na página — força uma remedição
    // (só acontece de fato enquanto o mini está escondido, ver acima).
    const agendarComRemedicao = () => { mini.hidden = true; linha2 && (linha2.hidden = true); agendar(); };

    window.addEventListener('scroll', agendar, { passive: true });
    window.addEventListener('resize', agendarComRemedicao);
    avaliar();
}

/**
 * Tema claro/escuro: lê a preferência salva, liga o botão do cabeçalho.
 */
function configurarTema() {
    const btn = document.getElementById('btnTema');

    const temaEfetivo = () => {
        const attr = document.documentElement.dataset.theme;
        if (attr === 'dark' || attr === 'light') return attr;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const aplicar = (tema) => {
        document.documentElement.dataset.theme = tema;
        try { localStorage.setItem('tema', tema); } catch (e) {}
        if (btn) btn.textContent = tema === 'dark' ? '☀️' : '🌙';
    };

    if (btn) {
        btn.textContent = temaEfetivo() === 'dark' ? '☀️' : '🌙';
        btn.addEventListener('click', () => aplicar(temaEfetivo() === 'dark' ? 'light' : 'dark'));
    }
}

/** Botão "olho" (olho fechado/aberto) — no lugar onde era o toggle de tema, na barra do
 *  mês (ver btnTema, que se mudou pro cabeçalho). */
const OLHO_FECHADO_SVG = `<svg viewBox="0 0 15 15" width="1.25em" height="1.25em" fill="none" aria-hidden="true" style="display:block"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.765 6.076a.5.5 0 0 1 .159.689 9.5 9.5 0 0 1-1.554 1.898l1.201 1.201a.5.5 0 0 1-.707.707l-1.263-1.263a8.5 8.5 0 0 1-2.667 1.343l.449 1.677a.5.5 0 0 1-.966.258l-.458-1.709Q8.25 11 7.5 11t-1.46-.123l-.457 1.71a.5.5 0 1 1-.966-.26l.45-1.676a8.5 8.5 0 0 1-2.668-1.343l-1.263 1.263a.5.5 0 1 1-.707-.707l1.2-1.201A9.5 9.5 0 0 1 .077 6.765a.5.5 0 0 1 .848-.53 8.4 8.4 0 0 0 1.77 2.034A7.46 7.46 0 0 0 7.5 9.999c2.808 0 5.156-1.493 6.576-3.764a.5.5 0 0 1 .689-.16" fill="currentColor"/></svg>`;
const OLHO_ABERTO_SVG = `<svg viewBox="0 0 15 15" width="1.25em" height="1.25em" fill="none" aria-hidden="true" style="display:block"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 11c-2.697 0-4.97-1.378-6.404-3.5C2.53 5.378 4.803 4 7.5 4s4.97 1.378 6.404 3.5C12.47 9.622 10.197 11 7.5 11m0-8C4.308 3 1.656 4.706.076 7.235a.5.5 0 0 0 0 .53C1.656 10.294 4.308 12 7.5 12s5.844-1.706 7.424-4.235a.5.5 0 0 0 0-.53C13.344 4.706 10.692 3 7.5 3m0 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4" fill="currentColor"/></svg>`;
function configurarOlhoValores() {
    const btn = document.getElementById('btnOlhoValores');
    if (!btn) return;
    const atualizarIcone = () => {
        btn.innerHTML = valoresOcultos ? OLHO_FECHADO_SVG : OLHO_ABERTO_SVG;
        btn.title = valoresOcultos ? 'Mostrar valores do dashboard' : 'Esconder valores do dashboard';
    };
    atualizarIcone();
    btn.addEventListener('click', () => {
        valoresOcultos = !valoresOcultos;
        try { localStorage.setItem('valoresOcultos', valoresOcultos ? '1' : '0'); } catch (_) {}
        atualizarIcone();
        if (typeof atualizarResumo === 'function') atualizarResumo();
    });
}

function adicionarEstilosDinamicos() {
    const css = `
        /* Animações */
        @keyframes slideInDown {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                transform: translateY(-20px);
            }
        }
        
        /* Classes utilitárias */
        .empty-message {
            text-align: center;
            color: #9CA3AF;
            padding: 2rem;
            font-style: italic;
        }
        
        .sugestoes.hidden {
            display: none;
        }
        
        /* Loading state */
        .carregando {
            opacity: 0.6;
            pointer-events: none;
        }
    `;
    
    adicionarCSSDinamico(css);
    console.log('✓ Estilos dinâmicos adicionados');
}

/**
 * Função global para recarregar aplicação (útil no console)
 */
window.recarregarApp = async function() {
    console.log('🔄 Recarregando aplicação...');
    resetarEstado();
    await carregarDados();
    atualizarUI();
    console.log('✓ Aplicação recarregada');
};

/**
 * Função de debug para mostrar estado atual
 */
window.debug = function() {
    console.table(estadoApp);
    console.log('Transações entrada:', estadoApp.transacoes.entradas.length);
    console.log('Transações saída:', estadoApp.transacoes.saidas.length);
    console.log('Resumo:', estadoApp.resumo);
};

/**
 * Tratamento de erros não capturados
 */
window.addEventListener('error', (event) => {
    console.error('❌ Erro não capturado:', event.error);
    mostrarNotificacao('❌ Erro na aplicação', 'erro');
});

/**
 * Tratamento de promessas não resolvidas
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Promise rejeitada:', event.reason);
    mostrarNotificacao('❌ Erro na requisição', 'erro');
});
