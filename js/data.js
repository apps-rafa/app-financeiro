/**
 * CARREGAMENTO DE DADOS
 * Busca dados do API e popula estado
 */

/**
 * Carrega todos os dados do mês atual
 */
async function carregarDados() {
    estadoApp.carregando = true;
    
    try {
        const mes = estadoApp.mesAtual.getMonth() + 1;
        const ano = estadoApp.mesAtual.getFullYear();

        console.log(`📊 Carregando dados de ${mes}/${ano}...`);

        // Auto-confirma "Até o 5º dia útil do mês" cujo prazo já passou
        if (typeof autoConfirmarVencidos === 'function') {
            try { await autoConfirmarVencidos(); } catch (e) { console.warn('autoConfirmar:', e); }
        }
        
        // Carregar entradas
        const entradas = await carregarTransacoes('entradas', mes, ano);
        estadoApp.transacoes.entradas = entradas;
        
        // Carregar saídas
        const saidas = await carregarTransacoes('saidas', mes, ano);
        estadoApp.transacoes.saidas = saidas;
        
        // Calcular resumo
        calcularResumoMes();
        
        console.log('✓ Dados carregados com sucesso');
        estadoApp.carregando = false;
        
        return true;
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        console.log('Usando dados simulados...');
        carregarDadosSimulados();
        estadoApp.carregando = false;
        
        return false;
    }
}

/**
 * Carrega dados de teste para quando API não responde
 */
function carregarDadosSimulados() {
    estadoApp.transacoes = {
        entradas: [
            {
                id: 2,
                data: '2026-09-30',
                valor: 8513.37,
                metodo: 'Transferência',
                categoria: 'Salário',
                descricao: 'Salário mensal',
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Último dia útil do mês',
                proximaData: '2026-10-30',
                status: 'Ativa'
            }
        ],
        saidas: [
            {
                id: 2,
                data: '2026-09-05',
                valor: 344.00,
                metodo: 'Débito',
                categoria: 'Alimentação',
                descricao: 'Mercado',
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Pontual',
                proximaData: '',
                status: 'Ativa'
            },
            {
                id: 3,
                data: '2026-09-03',
                valor: 229.80,
                metodo: 'PIX',
                categoria: 'Transporte app',
                descricao: 'Uber',
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Pontual',
                proximaData: '',
                status: 'Ativa'
            },
            {
                id: 4,
                data: '2026-09-01',
                valor: 3280.25,
                metodo: 'Débito',
                categoria: 'Casa',
                descricao: 'Condomínio',
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Mensal',
                proximaData: '2026-10-01',
                status: 'Ativa'
            }
        ]
    };
    
    calcularResumoMes();
    console.log('⚠️ Usando dados simulados');
}

/**
 * Carrega e popula menus dinâmicos
 */
async function carregarMenus() {
    try {
        console.log('📑 Carregando menus...');

        if (typeof semearMenusPadraoSeVazio === 'function') {
            await semearMenusPadraoSeVazio();
        }

        const menus = await carregarMenusAPI();
        
        estadoApp.menus.categorias = menus.categorias || [];
        estadoApp.menus.categoriasDespesa = menus.categoriasDespesa || [];
        estadoApp.menus.categoriasReceita = menus.categoriasReceita || [];
        estadoApp.menus.metodos = menus.metodos || [];
        estadoApp.menus.cores = menus.cores || { categoria: {}, metodo: {}, recorrencia: {} };
        estadoApp.menus.recorrencias = menus.recorrencias || [];

        console.log('✓ Menus carregados:', estadoApp.menus);

        // Preencher dropdowns
        preencherDropdownCategorias();
        preencherDropdownMetodos();
        preencherDropdownRecorrencias();

        return true;
    } catch (error) {
        console.error('Erro ao carregar menus:', error);
        console.log('Usando categorias padrão...');
        
        // Usar fallback
        estadoApp.menus.categoriasDespesa = CATEGORIAS_PADRAO.saidas || [];
        estadoApp.menus.categoriasReceita = CATEGORIAS_PADRAO.entradas || [];
        estadoApp.menus.categorias = [...estadoApp.menus.categoriasDespesa, ...estadoApp.menus.categoriasReceita];
        preencherDropdownCategorias();
        
        return false;
    }
}

/**
 * Preenche dropdown de categorias
 */
function preencherDropdownCategorias() {
    const selectCategoria = document.querySelector(SELECTORS.categoria);
    
    if (!selectCategoria || selectCategoria.tagName !== 'SELECT') {
        return;
    }
    
    selectCategoria.innerHTML = '<option value="">Selecione...</option>';

    // Lista específica conforme o tipo do lançamento (receita x despesa)
    const lista = estadoApp.tipoAtual === 'entradas'
        ? estadoApp.menus.categoriasReceita
        : estadoApp.menus.categoriasDespesa;

    (lista && lista.length ? lista : estadoApp.menus.categorias).forEach(categoria => {
        const option = document.createElement('option');
        option.value = categoria;
        option.textContent = categoria;
        selectCategoria.appendChild(option);
    });
}

/**
 * Preenche dropdown de métodos de pagamento
 */
function preencherDropdownMetodos() {
    const sel = document.querySelector(SELECTORS.metodo);
    if (!sel) return;
    const atual = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>';
    (estadoApp.menus.metodos || []).forEach(m => {
        const label = rotuloMetodo(m);
        const o = document.createElement('option');
        o.value = label;
        o.textContent = label;
        sel.appendChild(o);
    });
    sel.value = atual;
    if (typeof atualizarCampoCredito === 'function') atualizarCampoCredito();
}

// Ordem preferida de exibição dos tipos de recorrência
const ORDEM_RECORRENCIA = ['Pontual', 'Mensal', 'Parcelada',
    'Primeiro dia útil do mês', 'Até o 5º dia útil do mês', 'Último dia útil do mês',
    'Último dia útil do mês anterior', 'Semanal'];

// Rótulo curto exibido na UI (o valor interno / gravado no banco não muda)
const RECORRENCIA_ROTULO = {
    'Primeiro dia útil do mês': '1º dia útil',
    'Até o 5º dia útil do mês': '5º dia útil',
    'Último dia útil do mês': 'Último dia útil'
    // 'Último dia útil do mês anterior' permanece igual
};

/** Nome exibido de um tipo de recorrência (Mensal -> "Contas/Mensal" em despesa) */
function rotuloRecorrencia(tipo, ehDespesa) {
    if (tipo === 'Mensal' && ehDespesa) return 'Contas/Mensal';
    return RECORRENCIA_ROTULO[tipo] || tipo;
}

/**
 * Preenche o dropdown de recorrência. Tipos fixos do sistema (todos sempre).
 */
function preencherDropdownRecorrencias() {
    const sel = document.querySelector(SELECTORS.tipoRecorrencia);
    if (!sel) return;
    const atual = sel.value;

    // O tipo "Mensal" aparece como "Contas" nas despesas
    const ehDespesa = document.querySelector(SELECTORS.tipoTransacao)?.value === 'saidas';
    // Despesa não usa os tipos de "dia útil fixo" (só receita)
    const soReceita = typeof RECORRENCIA_DIA_UTIL !== 'undefined' ? RECORRENCIA_DIA_UTIL : [];
    // Ordem/ativação vêm do banco (estadoApp.menus.recorrencias já filtra status='Ativo'
    // e ordena por "ordem"); ORDEM_RECORRENCIA só serve de fallback antes do 1º carregamento.
    const ativos = (estadoApp.menus && estadoApp.menus.recorrencias && estadoApp.menus.recorrencias.length)
        ? estadoApp.menus.recorrencias
        : ORDEM_RECORRENCIA;
    // "Pontual" é o valor padrão do formulário — nunca pode sumir do dropdown
    const base = ativos.includes('Pontual') ? ativos : ['Pontual', ...ativos];
    const disponiveis = base.filter(t => !(ehDespesa && soReceita.includes(t)));

    sel.innerHTML = '';
    disponiveis.forEach(t => {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = rotuloRecorrencia(t, ehDespesa);
        sel.appendChild(o);
    });
    sel.value = disponiveis.includes(atual) ? atual : 'Pontual';
    if (typeof atualizarCamposRecorrencia === 'function') atualizarCamposRecorrencia();
}

/** Método selecionado no formulário (objeto do menu) ou null */
function metodoSelecionado() {
    const label = document.querySelector(SELECTORS.metodo)?.value;
    return (estadoApp.menus.metodos || []).find(m => rotuloMetodo(m) === label) || null;
}

/**
 * Calcula resumo do mês
 */
function calcularResumoMes() {
    const hoje = new Date().toISOString().slice(0, 10);
    const r2 = n => parseFloat(n.toFixed(2));

    // Métodos de crédito: o gasto só "realiza" (sai da fatura em aberto) depois
    // que o vencimento da fatura daquela competência já passou.
    const metodosCredito = new Map(
        ((estadoApp.menus && estadoApp.menus.metodos) || [])
            .filter(m => m.metodoKind === 'Crédito')
            .map(m => [(typeof rotuloMetodo === 'function' ? rotuloMetodo(m) : m.nome), m])
    );

    // Para cada transação: total (Semanal usa valorMes/Y) e "atual" (já realizado)
    const somar = lista => {
        let total = 0, atual = 0;
        lista.forEach(t => {
            const tot = (t.valorMes != null ? t.valorMes : t.valor) || 0;
            let realizado;
            const cartao = metodosCredito.get(t.metodo);
            if (cartao) {
                const venc = (cartao.diaVencimento && t.competencia)
                    ? dataVencimento(t.competencia, cartao.diaVencimento) : null;
                realizado = (venc && venc < hoje) ? tot : 0;
            } else if (t.tipoRecorrencia === 'Semanal' && t.valorMes != null) {
                realizado = t.valor || 0;                 // X (sessões já ocorridas)
            } else {
                realizado = (!t.pendente && String(t.data).slice(0, 10) < hoje) ? tot : 0;
            }
            total += tot;
            atual += realizado;
        });
        return { total: r2(total), atual: r2(atual), pendente: r2(total - atual) };
    };

    // Receita com método de cartão de crédito é estorno/reembolso lançado
    // na própria fatura (categoria fixa "Reembolso/Estorno" — ver
    // atualizarCampoMetodoReceita em js/ui.js), não dinheiro entrando de
    // verdade: abate da fatura desse cartão (Despesa) em vez de inflar a
    // Receita. Continua listada normalmente na aba Receita — só o resumo
    // do dashboard é que trata diferente.
    const entradasNormais = [], estornosCartao = [];
    estadoApp.transacoes.entradas.forEach(t =>
        (metodosCredito.has(t.metodo) ? estornosCartao : entradasNormais).push(t));

    const e = somar(entradasNormais);
    const s = somar(estadoApp.transacoes.saidas);
    const estorno = estornosCartao.length ? somar(estornosCartao) : { total: 0, atual: 0, pendente: 0 };

    estadoApp.resumo = {
        entradas: e.total,
        saidas: r2(s.total - estorno.total),
        balanco: r2(e.total - s.total + estorno.total),
        entradasAtual: e.atual,
        entradasAReceber: e.pendente,
        saidasAtual: r2(s.atual - estorno.atual),
        saidasAPagar: r2(s.pendente - estorno.pendente)
    };

    console.log('📈 Resumo calculado:', estadoApp.resumo);
}

/**
 * Recarrega dados e atualiza UI
 */
async function recarregarDados() {
    console.log('🔄 Recarregando dados...');
    await carregarDados();
    atualizarUI();
    // Navegou de mês: o campo Data acompanha o mês em exibição (se intocado)
    if (typeof aplicarDataPadrao === 'function') aplicarDataPadrao(false);
}
