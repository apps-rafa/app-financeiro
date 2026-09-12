/**
 * ESTADO GLOBAL DA APLICAÇÃO
 * Gerencia todos os dados do app
 */

let estadoApp = {
    // Navegação
    mesAtual: new Date(),
    tipoAtual: 'saidas', // 'entradas' ou 'saidas'
    
    // Dados de transações
    transacoes: {
        entradas: [],
        saidas: []
    },
    
    // Resumo mensal
    resumo: {
        entradas: 0,
        saidas: 0,
        balanco: 0
    },
    
    // Menus dinâmicos
    menus: {
        categorias: [],
        categoriasDespesa: [],
        categoriasReceita: [],
        metodos: [],
        recorrencias: [],
        cores: { categoria: {}, metodo: {}, recorrencia: {} }
    },

    // Id da transação sendo editada (null = criando)
    editandoId: null,

    // Status de loading
    carregando: false,
    erro: null
};

/**
 * Atualiza o estado com novos dados
 */
function atualizarEstado(chave, valor) {
    estadoApp[chave] = valor;
    console.log('Estado atualizado:', chave, valor);
}

/**
 * Reset completo do estado
 */
function resetarEstado() {
    estadoApp.transacoes.entradas = [];
    estadoApp.transacoes.saidas = [];
    estadoApp.resumo = { entradas: 0, saidas: 0, balanco: 0 };
    estadoApp.menus = { categorias: [], categoriasDespesa: [], categoriasReceita: [], metodos: [], recorrencias: [], cores: { categoria: {}, metodo: {}, recorrencia: {} } };
    estadoApp.erro = null;
}

/**
 * Obtém dados de um tipo específico
 */
function obterDados(tipo) {
    return estadoApp.transacoes[tipo] || [];
}

/**
 * Obtém resumo formatado
 */
function obterResumoFormatado() {
    return {
        entradas: formatarMoeda(estadoApp.resumo.entradas),
        saidas: formatarMoeda(estadoApp.resumo.saidas),
        balanco: formatarMoeda(estadoApp.resumo.balanco),
        negativo: estadoApp.resumo.balanco < 0,
        positivo: estadoApp.resumo.balanco > 0
    };
}
