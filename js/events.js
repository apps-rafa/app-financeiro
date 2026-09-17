/**
 * EVENTOS E INTERAÇÕES
 * Handlers e event listeners
 */

/**
 * Configura todos os event listeners
 */
function configurarEventListeners() {
    console.log('⚙️ Configurando event listeners...');
    
    // Navegação de calendário: tira de meses (clique seleciona de verdade),
    // setas laterais andam a janela E mudam a seleção junto — o mês do meio
    // é sempre o selecionado — + "casinha" (volta pro mês vigente). O ano
    // ao lado é fixo no vigente, sem interação.
    const mesesLista = document.getElementById('mesesLista');
    if (mesesLista) mesesLista.addEventListener('click', e => {
        const btn = e.target.closest('.mes-btn');
        if (!btn) return;
        const ano = parseInt(btn.dataset.ano, 10);
        const mes = parseInt(btn.dataset.mes, 10);
        if (Number.isNaN(ano) || Number.isNaN(mes)) return;
        estadoApp.mesAtual = new Date(ano, mes, 1);
        recarregarDados();
    });
    const mesesSetaEsq = document.getElementById('mesesSetaEsq');
    if (mesesSetaEsq) mesesSetaEsq.addEventListener('click', () => {
        estadoApp.mesAtual = new Date(estadoApp.mesAtual.getFullYear(), estadoApp.mesAtual.getMonth() - 1, 1);
        recarregarDados();
    });
    const mesesSetaDir = document.getElementById('mesesSetaDir');
    if (mesesSetaDir) mesesSetaDir.addEventListener('click', () => {
        estadoApp.mesAtual = new Date(estadoApp.mesAtual.getFullYear(), estadoApp.mesAtual.getMonth() + 1, 1);
        recarregarDados();
    });
    const btnMesAtual = document.getElementById('btnMesAtual');
    if (btnMesAtual) btnMesAtual.addEventListener('click', () => {
        const hoje = new Date();
        estadoApp.mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        recarregarDados();
    });
    window.addEventListener('resize', debounce(() => {
        if (typeof atualizarCalendarioNav === 'function') atualizarCalendarioNav();
    }, 150));

    // Seletor de tipo (Despesa/Receita) do formulário "Novo lançamento" —
    // escopado: "Próximas" tem seu próprio filtro com a mesma classe
    // .tipo-btn, e não deve disparar mudarTipoTransacao().
    const tipoButtons = document.querySelectorAll(`${SELECTORS.formTransacao} .tipo-btn`);
    tipoButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tipo = btn.dataset.tipo;
            mudarTipoTransacao(tipo);
        });
    });
    
    // Abas
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            mudarAba(tab);
        });
    });

    // Engrenagem "Configuração" na barra do mês: abre/fecha (toggle)
    const btnConfig = document.getElementById('btnConfig');
    if (btnConfig) btnConfig.addEventListener('click', () => mudarAba('menus'));

    // Aba Despesas: alternar "Por recorrência" / "Por método" / "Por categoria"
    // — toggle: sem nenhum ligado, fica em ordem cronológica.
    const modoSaidas = document.getElementById('modoSaidas');
    if (modoSaidas) modoSaidas.addEventListener('click', e => {
        const btn = e.target.closest('.modo-btn');
        if (btn && typeof definirModoListaSaidas === 'function') definirModoListaSaidas(btn.dataset.modo);
    });

    // Aba Receitas: alternar "Por recorrência" / "Por categoria"
    const modoEntradas = document.getElementById('modoEntradas');
    if (modoEntradas) modoEntradas.addEventListener('click', e => {
        const btn = e.target.closest('.modo-btn');
        if (btn && typeof definirModoListaEntradas === 'function') definirModoListaEntradas(btn.dataset.modo);
    });

    // Ícone do funil: desliga o filtro ativo (se nenhum estiver ligado, não
    // faz nada) — mesmo efeito de clicar de novo no botão já ativo.
    document.getElementById('modoSaidasIcone')?.addEventListener('click', () => {
        if (modoListaSaidas !== 'cronologica' && typeof definirModoListaSaidas === 'function') {
            definirModoListaSaidas(modoListaSaidas);
        }
    });
    document.getElementById('modoEntradasIcone')?.addEventListener('click', () => {
        if (modoListaEntradas !== 'cronologica' && typeof definirModoListaEntradas === 'function') {
            definirModoListaEntradas(modoListaEntradas);
        }
    });

    // Busca em tempo real (Receitas/Despesas) — filtra a cada tecla, funciona
    // igual em qualquer modo de visualização (ver _filtrarPorBusca em js/ui.js).
    const buscaSaidasEl = document.getElementById('buscaSaidas');
    if (buscaSaidasEl) buscaSaidasEl.addEventListener('input', e => {
        if (typeof definirBuscaSaidas === 'function') definirBuscaSaidas(e.target.value);
    });
    const buscaEntradasEl = document.getElementById('buscaEntradas');
    if (buscaEntradasEl) buscaEntradasEl.addEventListener('input', e => {
        if (typeof definirBuscaEntradas === 'function') definirBuscaEntradas(e.target.value);
    });

    // Aba Próximas: filtro de tipo (Despesa/Receita) + modo de agrupamento
    // (o conjunto de modos disponíveis muda conforme o tipo escolhido)
    const tipoProximas = document.getElementById('tipoProximas');
    if (tipoProximas) tipoProximas.addEventListener('click', e => {
        const btn = e.target.closest('.tipo-btn');
        if (btn && typeof definirTipoProximas === 'function') definirTipoProximas(btn.dataset.tipo);
    });
    const modoProximas = document.getElementById('modoProximas');
    if (modoProximas) modoProximas.addEventListener('click', e => {
        const btn = e.target.closest('.modo-btn');
        if (btn && typeof definirModoListaProximas === 'function') definirModoListaProximas(btn.dataset.modo);
    });

    // Cards de Receitas/Despesas do dashboard abrem/fecham a aba correspondente
    // (toggle) — agora que os botões de aba "Despesas"/"Receitas" saíram da
    // barra de navegação, o card é o único jeito de abrir E fechar essa
    // visão, então precisa do toggle que mudarAba() já tem embutido.
    document.querySelector('.summary-card.entradas')?.addEventListener('click', () => mudarAba('entradas'));
    document.querySelector('.summary-card.saidas')?.addEventListener('click', () => mudarAba('saidas'));

    // Aviso "⚠️ Duplicatas" dentro do card — clique próprio (não é só abrir a
    // aba: precisa também abrir o grupo de duplicatas já expandido), então
    // para a propagação pro listener do card acima (que só faz toggle).
    document.querySelectorAll('.dup-aviso').forEach(badge => {
        badge.addEventListener('click', e => {
            e.stopPropagation();
            if (typeof abrirGrupoDuplicatas === 'function') abrirGrupoDuplicatas(badge.dataset.dupAviso);
        });
    });
    
    // Formulário
    const form = document.querySelector(SELECTORS.formTransacao);
    if (form) {
        form.addEventListener('submit', submeterFormulario);
    }
    
    // Método -> mostra campo de competência se for Crédito
    const metodo = document.querySelector(SELECTORS.metodo);
    if (metodo) metodo.addEventListener('change', atualizarCampoCredito);

    // Apagar o lançamento direto da tela de edição
    const excluirEdicao = document.getElementById('excluirEdicao');
    if (excluirEdicao) excluirEdicao.addEventListener('click', excluirEdicaoTransacao);

    // Botão "×" do formulário: em edição volta para a origem; senão, só fecha
    const btnLimparForm = document.getElementById('btnLimparForm');
    if (btnLimparForm) btnLimparForm.addEventListener('click', () => {
        if (estadoApp.editandoId) {
            cancelarEdicaoTransacao();            // volta para a aba de origem
        } else {
            limparFormulario();
            fecharAbas();
        }
    });

    // Botão "×" ao lado dos filtros de Receitas/Despesas/Próximas/Configurações:
    // só fecha. Delegado no document (não em cada botão) porque a de
    // Configurações é recriada do zero a cada carregarAbaMenus().
    document.addEventListener('click', e => {
        if (e.target.closest('.btn-fechar-aba')) fecharAbas();
    });

    // Campo Data: máscara dd/mm/aaaa + recalcular competência
    const dataInput = document.querySelector(SELECTORS.data);
    if (dataInput) {
        ligarCampoData(dataInput);
        dataInput.addEventListener('input', () => {
            mascaraDataBR(dataInput);
            // Guarda a data digitada pelo usuário (para restaurar ao desmarcar
            // "pagar no vencimento" ou sair de uma recorrência que calcula a data)
            if (!dataInput.readOnly) dataInput.dataset.userVal = dataInput.value;
            recalcularCompetencia();
            atualizarCampoParcelas();
            // Digitou um mês diferente do que tá navegado no topo? A navegação acompanha.
            const m = String(dataInput.value || '').match(/^\d{1,2}\/(\d{1,2})$/);
            if (m) sincronizarMesComFormulario(parseInt(m[1], 10));
        });
    }

    // Competência (mês): select de tricode; marca como editado manualmente
    const compInput = document.getElementById('competencia');
    if (compInput) {
        compInput.addEventListener('change', () => {
            compInput.dataset.editado = '1';
            sincronizarMesComFormulario(parseInt(compInput.value, 10));
        });
    }


    // Botões "+" para criar categoria/método sem sair do lançamento
    const btnCat = document.getElementById('btnNovaCategoria');
    if (btnCat) btnCat.addEventListener('click', abrirNovaCategoria);
    const btnMet = document.getElementById('btnNovoMetodo');
    if (btnMet) btnMet.addEventListener('click', abrirNovoMetodo);

    const valorInput = document.querySelector(SELECTORS.valor);
    if (valorInput) {
        // type="number" ainda deixa passar "e"/"+"/"-" (notação científica/negativo,
        // que não fazem sentido pra um valor de lançamento) — bloqueia na digitação.
        valorInput.addEventListener('keydown', e => {
            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
        });
        valorInput.addEventListener('input', () => {
            // Cobre o caso de colar "1e5" (válido pro <input type=number>, mas
            // sem sentido aqui) — se sobrou "e"/"+"/"-", zera o valor.
            if (/[eE+-]/.test(valorInput.value)) valorInput.value = '';
        });
    }
    // Parcelas: só números, 2 dígitos -> mostra/esconde "Parcelas" x "à vista"
    const parcInput = document.getElementById('parcelas');
    if (parcInput) parcInput.addEventListener('input', () => {
        soNumeros(parcInput, 2);
        if (typeof atualizarCampoParcelas === 'function') atualizarCampoParcelas();
    });

    // Setinhas ▲▼ de "Parcelas": aumentam/diminuem 1 e disparam o mesmo
    // "input" que digitar direto no campo dispararia.
    document.querySelectorAll('[data-stepper]').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.stepper);
            if (!input || input.readOnly || input.disabled) return;
            const min = parseInt(btn.dataset.min, 10) || 1;
            const max = parseInt(btn.dataset.max, 10) || 99;
            const dir = parseInt(btn.dataset.dir, 10) || 0;
            let v = parseInt(input.value, 10);
            if (Number.isNaN(v)) v = dir > 0 ? min - 1 : min + 1;
            v = Math.min(max, Math.max(min, v + dir));
            input.value = String(v);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    // Campo de categoria para sugestões (opcional)
    const categoriaInput = document.querySelector(SELECTORS.categoria);
    if (categoriaInput && categoriaInput.tagName === 'INPUT') {
        categoriaInput.addEventListener('input', mostrarSugestoes);
        categoriaInput.addEventListener('blur', ocultarSugestoes);
    } else if (categoriaInput && typeof atualizarCampoMetodoReceita === 'function') {
        categoriaInput.addEventListener('change', atualizarCampoMetodoReceita);
    }
    
    // Reavalia labels curtos/longos e campos "sozinhos" quando a largura muda
    if (typeof atualizarCampoParcelas === 'function') {
        let rTimer;
        window.addEventListener('resize', () => {
            clearTimeout(rTimer);
            rTimer = setTimeout(() => {
                if (document.getElementById('adicionar')?.classList.contains('active')) {
                    atualizarCampoParcelas();
                }
            }, 150);
        });
    }

    // Idem pros valores do dashboard (Receita/Despesa/Balanço/Gasto diário
    // e o botão "Próximos" do resumo compacto) — a largura do card muda com
    // a tela, então o que cabia pode deixar de caber (ou sobrar espaço).
    if (typeof ajustarFontesDashboard === 'function') {
        let dTimer;
        window.addEventListener('resize', () => {
            clearTimeout(dTimer);
            dTimer = setTimeout(ajustarFontesDashboard, 150);
        });
    }

    console.log('✓ Event listeners configurados');
}

/**
 * Se o mês "digitado"/escolhido no formulário de lançamento for diferente do
 * mês em exibição no topo, a navegação acompanha (some meses no formulário
 * — Data, Comp., mês de referência do dia útil — não têm campo de ano; o
 * ano usado é sempre o do mês em exibição, só o mês pode mudar por aqui).
 * Não mexe durante edição de um lançamento existente.
 */
function sincronizarMesComFormulario(mes) {
    if (typeof estadoApp === 'undefined' || !estadoApp.mesAtual || estadoApp.editandoId) return;
    if (!(mes >= 1 && mes <= 12)) return;
    if (estadoApp.mesAtual.getMonth() + 1 === mes) return;
    estadoApp.mesAtual = new Date(estadoApp.mesAtual.getFullYear(), mes - 1, 1);
    if (typeof recarregarDados === 'function') recarregarDados();
}

/**
 * Muda tipo de transação (entrada/saída)
 */
function mudarTipoTransacao(tipo) {
    const mudou = estadoApp.tipoAtual !== tipo;
    estadoApp.tipoAtual = tipo;
    console.log(`🔄 Tipo alterado para: ${tipo}`);

    // Atualizar botões — escopado ao formulário: "Próximas" reusa a mesma
    // classe .tipo-btn pro filtro dela, então um seletor global aqui acaba
    // grudando o "active" no botão errado (o da outra tela).
    const formEl = document.querySelector(SELECTORS.formTransacao);
    formEl?.querySelectorAll('.tipo-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    formEl?.querySelector(`.tipo-btn[data-tipo="${tipo}"]`)?.classList.add('active');

    // Atualizar campo oculto
    const tipoField = document.querySelector(SELECTORS.tipoTransacao);
    if (tipoField) tipoField.value = tipo;

    // Trocar receita <-> despesa zera tudo que estiver preenchido (fora da edição)
    if (mudou && !estadoApp.editandoId) {
        const form = document.querySelector(SELECTORS.formTransacao);
        form?.reset();
        if (tipoField) tipoField.value = tipo;            // reset() volta ao default
        const dataEl = document.querySelector(SELECTORS.data);
        if (dataEl) { dataEl.readOnly = false; dataEl.classList.remove('campo-travado'); aplicarDataPadrao(true); }
    }

    // Limpar categoria e recarregar opções
    const categoriaField = document.querySelector(SELECTORS.categoria);
    if (categoriaField) categoriaField.value = '';

    if (typeof atualizarLabelsPorTipo === 'function') atualizarLabelsPorTipo();
    if (typeof atualizarCampoParcelas === 'function') atualizarCampoParcelas();

    // Recarregar menus para o novo tipo — se o usuário trocar de tipo antes
    // dos menus carregarem pela 1a vez (ex.: clicou rápido, "+ Lançamento"
    // recém aberto), reaplica a visibilidade dos campos depois que os dados
    // chegarem, pra não ficar com um estado calculado antes de tempo.
    carregarMenus().then(() => {
        if (estadoApp.tipoAtual !== tipo) return; // trocou de novo enquanto carregava
        if (typeof atualizarLabelsPorTipo === 'function') atualizarLabelsPorTipo();
        if (typeof atualizarCampoParcelas === 'function') atualizarCampoParcelas();
    });
}

/**
 * Muda aba ativa
 */
/** Desativa todas as abas (nenhum conteúdo aberto) */
function fecharAbas() {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[data-tab], #btnConfig').forEach(b => b.classList.remove('active'));
    document.getElementById('btnConfig')?.setAttribute('aria-pressed', 'false');
    if (typeof resetarModosListaParaCronologica === 'function') resetarModosListaParaCronologica();
}

function mudarAba(novaAba) {
    const ativa = document.querySelector('.tab-content.active')?.id;

    // Clicar na aba já aberta apenas fecha tudo (sem reabrir nada).
    if (novaAba === ativa) {
        fecharAbas();
        return;
    }
    console.log(`📑 Mudando para aba: ${novaAba}`);

    // Abrir a nova aba fecha automaticamente qualquer outra.
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('[data-tab], #btnConfig').forEach(btn => {
        btn.classList.remove('active');
    });

    // Adicionar classe active
    document.getElementById(novaAba)?.classList.add('active');
    document.querySelector(`[data-tab="${novaAba}"]`)?.classList.add('active');
    document.getElementById('btnConfig')?.setAttribute('aria-pressed', String(novaAba === 'menus'));

    // Receita/Despesa/Próximas sempre abrem no filtro Cronológica, nunca no
    // modo em que a aba ficou da última vez.
    if (['entradas', 'saidas', 'proximas'].includes(novaAba) && typeof resetarModosListaParaCronologica === 'function') {
        resetarModosListaParaCronologica();
    }

    // Ações específicas
    if (novaAba === 'entradas') {
        if (typeof atualizarEntradasLista === 'function') atualizarEntradasLista();
    } else if (novaAba === 'saidas') {
        if (typeof atualizarSaidasLista === 'function') atualizarSaidasLista();
        // Renderizar gráfico após pequeno delay
        setTimeout(atualizarGrafico, 100);
    } else if (novaAba === 'proximas') {
        // Carregar próximas transações
        atualizarProximasTransacoes();
    } else if (novaAba === 'menus') {
        // Carregar aba de gerenciamento de menus
        carregarAbaMenus();
    } else if (novaAba === 'adicionar' && !estadoApp.editandoId) {
        // Abrir "+ Lançamento" novo: começa sempre limpo e coerente
        if (typeof limparFormulario === 'function') limparFormulario();
    }
}

/**
 * Submete formulário de transação
 */
async function submeterFormulario(e) {
    e.preventDefault();
    console.log('📝 Submetendo formulário...');
    
    const dados = obterDadosFormulario();
    
    // Validar
    const validacao = validarFormularioTransacao(dados);
    if (!validacao.valido) {
        mostrarNotificacao('❌ ' + validacao.erro, 'erro');
        return;
    }
    
    const foiEdicao = !!estadoApp.editandoId;
    const abaOrigem = estadoApp.abaOrigemEdicao;

    try {
        if (foiEdicao) {
            await editarTransacaoAPI({ id: estadoApp.editandoId, ...dados });
            mostrarNotificacao('✓ Transação atualizada!', 'sucesso');
            cancelarEdicaoTransacao(false);
        } else {
            await adicionarTransacaoAPI(dados);
            mostrarNotificacao('✓ Lançamento adicionado!', 'sucesso');
            limparFormulario();
        }

        // Recarregar dados
        await recarregarDados();

        if (foiEdicao) {
            // Edição volta para a tela onde o usuário estava
            setTimeout(() => mudarAba(abaOrigem || dados.tipo), 500);
        }
        // Lançamento novo: fica no formulário em branco (já foi limpo acima),
        // pra encadear vários lançamentos seguidos sem trocar de aba.

    } catch (error) {
        console.error('Erro ao salvar transação:', error);
        mostrarNotificacao('❌ Erro ao salvar transação', 'erro');
    }
}

/**
 * Mostra sugestões de categorias
 */
function mostrarSugestoes(e) {
    const valor = e.target.value.toLowerCase();
    const container = document.querySelector(SELECTORS.categoriaSugestoes);
    
    if (!container) return;
    
    const listaTipo = estadoApp.tipoAtual === 'entradas'
        ? estadoApp.menus.categoriasReceita
        : estadoApp.menus.categoriasDespesa;
    const categorias = (listaTipo && listaTipo.length > 0)
        ? listaTipo
        : (CATEGORIAS_PADRAO[estadoApp.tipoAtual] || []);
    
    if (!valor) {
        container.classList.add('hidden');
        return;
    }
    
    const filtradas = categorias.filter(cat =>
        cat.toLowerCase().includes(valor)
    );
    
    if (filtradas.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    let html = '';
    filtradas.forEach(cat => {
        html += `<div class="sugestao-item" onclick="selecionarSugestao('${cat}')">${cat}</div>`;
    });
    
    container.innerHTML = html;
    container.classList.remove('hidden');
}

/**
 * Oculta sugestões após delay
 */
function ocultarSugestoes() {
    setTimeout(() => {
        const container = document.querySelector(SELECTORS.categoriaSugestoes);
        if (container) container.classList.add('hidden');
    }, 200);
}

/**
 * Seleciona uma sugestão
 */
function selecionarSugestao(categoria) {
    const categoriaField = document.querySelector(SELECTORS.categoria);
    if (categoriaField) {
        categoriaField.value = categoria;
        document.querySelector(SELECTORS.categoriaSugestoes)?.classList.add('hidden');
        document.querySelector(SELECTORS.valor)?.focus();
    }
}
