/**
 * ESTADO GLOBAL DA APLICAÇÃO
 * Gerencia todos os dados do app
 */

/** true = valores do dashboard (cards + resumo compacto) aparecem mascarados
 *  ("••••") em vez do número — padrão dos apps de banco, útil pra não
 *  mostrar saldo com alguém do lado (ver configurarOlhoValores em main.js e
 *  a máscara em atualizarResumo, js/ui.js). Lido de localStorage; por
 *  padrão vem ESCONDIDO (primeira vez que o app abre num aparelho).
 *  Declarado aqui (um dos primeiros scripts a carregar), não em main.js (o
 *  último) — main.js é o único que EXECUTA depois do DOMContentLoaded, mas
 *  um callback assíncrono de outro script (ex.: auth.js) pode chamar
 *  atualizarUI() enquanto a página ainda está carregando os scripts
 *  seguintes; se essa variável só existisse lá no fim, essa leitura
 *  antecipada cairia na "temporal dead zone" do let e quebraria a função. */
let valoresOcultos = true;
try {
    const v = localStorage.getItem('valoresOcultos');
    valoresOcultos = v === null ? true : v === '1';
} catch (_) {}

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
        cores: { categoria: {}, metodo: {} }
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
    estadoApp.menus = { categorias: [], categoriasDespesa: [], categoriasReceita: [], metodos: [], cores: { categoria: {}, metodo: {} } };
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
