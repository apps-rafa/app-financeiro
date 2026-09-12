/**
 * EVENTOS E INTERAÇÕES
 * Handlers e event listeners
 */

/**
 * Configura todos os event listeners
 */
function configurarEventListeners() {
    console.log('⚙️ Configurando event listeners...');
    
    // Navegação de meses
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');
    
    if (prevBtn) prevBtn.addEventListener('click', mesAnterior);
    if (nextBtn) nextBtn.addEventListener('click', proximoMes);

    // Clicar no nome do mês volta para o mês vigente
    const mesLabel = document.getElementById('currentMonth');
    if (mesLabel) {
        mesLabel.style.cursor = 'pointer';
        mesLabel.title = 'Voltar ao mês atual';
        mesLabel.addEventListener('click', irParaMesVigente);
    }
    
    // Seletor de tipo
    const tipoButtons = document.querySelectorAll('.tipo-btn');
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

    // Aba Despesas: alternar "Por recorrência" / "Por método"
    const modoSaidas = document.getElementById('modoSaidas');
    if (modoSaidas) modoSaidas.addEventListener('click', e => {
        const btn = e.target.closest('.modo-btn');
        if (btn && typeof definirModoListaSaidas === 'function') definirModoListaSaidas(btn.dataset.modo);
    });

    // Cards de Receitas/Despesas do dashboard abrem a aba correspondente (sem toggle)
    const abrirAba = alvo => {
        if (document.querySelector('.tab-content.active')?.id !== alvo) mudarAba(alvo);
    };
    document.querySelector('.summary-card.entradas')?.addEventListener('click', () => abrirAba('entradas'));
    document.querySelector('.summary-card.saidas')?.addEventListener('click', () => abrirAba('saidas'));
    
    // Formulário
    const form = document.querySelector(SELECTORS.formTransacao);
    if (form) {
        form.addEventListener('submit', submeterFormulario);
    }
    
    // Campo de tipo de recorrência
    const tipoRecorrencia = document.querySelector(SELECTORS.tipoRecorrencia);
    if (tipoRecorrencia) {
        tipoRecorrencia.addEventListener('change', atualizarCamposRecorrencia);
    }

    // Método -> mostra campo de competência se for Crédito
    const metodo = document.querySelector(SELECTORS.metodo);
    if (metodo) metodo.addEventListener('change', atualizarCampoCredito);

    // Cancelar edição de transação
    const cancelar = document.getElementById('cancelarEdicao');
    if (cancelar) cancelar.addEventListener('click', cancelarEdicaoTransacao);

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
            atualizarCamposRecorrencia();
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

    // Dia da recorrência: só números, 2 dígitos; recalcula "pagar no vencimento"
    const diaRec = document.getElementById('diaRecorrencia');
    if (diaRec) diaRec.addEventListener('input', () => {
        soNumeros(diaRec, 2);
        if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();
    });

    // Checkbox "pagar no vencimento"
    const pagarVenc = document.getElementById('pagarVencimento');
    if (pagarVenc) pagarVenc.addEventListener('change', aplicarPagarVencimento);

    // Recorrências "dia útil fixo": mês de referência (select de tricode)
    const compRec = document.getElementById('compRecorrente');
    if (compRec) compRec.addEventListener('change', () => {
        atualizarCamposRecorrencia();
        sincronizarMesComFormulario(parseInt(compRec.value, 10));
    });

    // Botões "+" para criar categoria/método sem sair do lançamento
    const btnCat = document.getElementById('btnNovaCategoria');
    if (btnCat) btnCat.addEventListener('click', abrirNovaCategoria);
    const btnMet = document.getElementById('btnNovoMetodo');
    if (btnMet) btnMet.addEventListener('click', abrirNovoMetodo);

    // Semanal: dia da semana -> refaz as chips; valor -> resumo X/Y + total
    const diaSem = document.getElementById('diaSemana');
    if (diaSem) diaSem.addEventListener('change', atualizarCamposRecorrencia);
    const valorInput = document.querySelector(SELECTORS.valor);
    if (valorInput) valorInput.addEventListener('input', () => {
        if (typeof atualizarResumoSemanas === 'function') atualizarResumoSemanas();
        if (typeof atualizarValorTotal === 'function') atualizarValorTotal();
    });
    // Parcelada: nº de parcelas (só números, 2 dígitos) -> recalcula o total
    const parcInput = document.getElementById('parcelas');
    if (parcInput) parcInput.addEventListener('input', () => {
        soNumeros(parcInput, 2);
        if (typeof atualizarValorTotal === 'function') atualizarValorTotal();
    });
    
    // Campo de categoria para sugestões (opcional)
    const categoriaInput = document.querySelector(SELECTORS.categoria);
    if (categoriaInput && categoriaInput.tagName === 'INPUT') {
        categoriaInput.addEventListener('input', mostrarSugestoes);
        categoriaInput.addEventListener('blur', ocultarSugestoes);
    }
    
    // Reavalia labels curtos/longos e campos "sozinhos" quando a largura muda
    if (typeof atualizarCamposRecorrencia === 'function') {
        let rTimer;
        window.addEventListener('resize', () => {
            clearTimeout(rTimer);
            rTimer = setTimeout(() => {
                if (document.getElementById('adicionar')?.classList.contains('active')) {
                    atualizarCamposRecorrencia();
                }
            }, 150);
        });
    }

    console.log('✓ Event listeners configurados');
}

/**
 * Muda para mês anterior
 */
function mesAnterior() {
    estadoApp.mesAtual.setMonth(estadoApp.mesAtual.getMonth() - 1);
    recarregarDados();
}

/**
 * Muda para próximo mês
 */
function proximoMes() {
    estadoApp.mesAtual.setMonth(estadoApp.mesAtual.getMonth() + 1);
    recarregarDados();
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
 * Volta para o mês vigente (hoje)
 */
function irParaMesVigente() {
    const hoje = new Date();
    if (estadoApp.mesAtual.getFullYear() === hoje.getFullYear()
        && estadoApp.mesAtual.getMonth() === hoje.getMonth()) return;
    estadoApp.mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    recarregarDados();
}

/**
 * Muda tipo de transação (entrada/saída)
 */
function mudarTipoTransacao(tipo) {
    const mudou = estadoApp.tipoAtual !== tipo;
    estadoApp.tipoAtual = tipo;
    console.log(`🔄 Tipo alterado para: ${tipo}`);

    // Atualizar botões
    document.querySelectorAll('.tipo-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tipo="${tipo}"]`)?.classList.add('active');

    // Atualizar campo oculto
    const tipoField = document.querySelector(SELECTORS.tipoTransacao);
    if (tipoField) tipoField.value = tipo;

    // Trocar receita <-> despesa zera tudo que estiver preenchido (fora da edição)
    if (mudou && !estadoApp.editandoId) {
        const form = document.querySelector(SELECTORS.formTransacao);
        form?.reset();
        if (tipoField) tipoField.value = tipo;            // reset() volta ao default
        const dataEl = document.querySelector(SELECTORS.data);
        if (dataEl) { dataEl.readOnly = false; dataEl.classList.remove('campo-travado'); delete dataEl.dataset.autoReceita; aplicarDataPadrao(true); }
        const pv = document.getElementById('pagarVencimento');
        if (pv) pv.checked = false;
        if (typeof semanasMarcadas !== 'undefined') semanasMarcadas = new Set();
    }

    // Limpar categoria e recarregar opções
    const categoriaField = document.querySelector(SELECTORS.categoria);
    if (categoriaField) categoriaField.value = '';

    if (typeof atualizarLabelsPorTipo === 'function') atualizarLabelsPorTipo();
    if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();

    // Recarregar menus para o novo tipo
    carregarMenus();
}

/**
 * Muda aba ativa
 */
/** Desativa todas as abas (nenhum conteúdo aberto) */
function fecharAbas() {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn, #btnConfig').forEach(b => b.classList.remove('active'));
    document.getElementById('btnConfig')?.setAttribute('aria-pressed', 'false');
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
    document.querySelectorAll('.tab-btn, #btnConfig').forEach(btn => {
        btn.classList.remove('active');
    });

    // Adicionar classe active
    document.getElementById(novaAba)?.classList.add('active');
    document.querySelector(`[data-tab="${novaAba}"]`)?.classList.add('active');
    document.getElementById('btnConfig')?.setAttribute('aria-pressed', String(novaAba === 'menus'));

    // Ações específicas
    if (novaAba === 'saidas') {
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

        // Edição volta para a tela onde o usuário estava; novo lançamento vai p/ a lista do tipo
        const destino = foiEdicao ? (abaOrigem || dados.tipo) : dados.tipo;
        setTimeout(() => mudarAba(destino), 500);

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
