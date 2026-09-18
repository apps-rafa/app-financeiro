/**
 * API - SUPABASE
 * Comunicação com o banco de dados Supabase (Postgres).
 * Substitui as antigas chamadas fetch ao Google Apps Script.
 * Mantém as mesmas assinaturas de função usadas pelo resto do app.
 */

/**
 * Converte uma linha do banco (snake_case) para o formato usado na UI (camelCase)
 */
function mapearTransacao(row) {
    let valor = parseFloat(row.valor) || 0;
    // valorMes = valor do mês. Só o Semanal difere (Y = todas as sessões);
    // NÃO usar valor_total aqui — no parcelado ele é o total do parcelamento.
    let valorMes = valor;
    const semanas = Array.isArray(row.semanas) ? row.semanas : null;
    const valorSessao = row.valor_sessao != null ? parseFloat(row.valor_sessao) : null;

    // Semanal: X (realizado até hoje) e Y (total do mês) recalculados na leitura
    if (row.tipo_recorrencia === 'Semanal' && semanas && valorSessao != null) {
        const hoje = hojeISO();
        valor = semanas.filter(d => d <= hoje).length * valorSessao;   // X
        valorMes = semanas.length * valorSessao;                        // Y
    }

    return {
        id: row.id,
        data: row.data,
        valor,
        valorMes,
        valorSessao,
        semanas,
        metodo: row.metodo || '',
        categoria: row.categoria || '',
        descricao: row.descricao || '',
        formaPagamento: row.forma_pagamento || 'À vista',
        tipoRecorrencia: row.tipo_recorrencia || 'Pontual',
        proximaData: row.proxima_data || '',
        status: row.status || 'Ativa',
        cartaoId: row.cartao_id || null,
        grupoId: row.grupo_id || null,
        pendente: !!row.pendente,
        parcelaNum: row.parcela_num || null,
        parcelasTotal: row.parcelas_total || null,
        valorTotal: row.valor_total != null ? parseFloat(row.valor_total) : null,
        quitada: !!row.quitada,
        quitadoEm: row.quitado_em || null,
        competencia: row.competencia || '',
        diaRecorrencia: row.dia_recorrencia || '',
        diaSemana: row.dia_semana ?? null,
        pagarNoVencimento: !!row.pagar_no_vencimento
    };
}

/**
 * Primeiro e último dia (exclusivo) de um mês -> ['YYYY-MM-01', 'YYYY-MM-01' do mês seguinte]
 */
function intervaloDoMes(mes, ano) {
    const ini = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const proxMes = mes === 12 ? 1 : mes + 1;
    const proxAno = mes === 12 ? ano + 1 : ano;
    const fim = `${proxAno}-${String(proxMes).padStart(2, '0')}-01`;
    return [ini, fim];
}

/**
 * Carrega transações de um tipo ('entradas' | 'saidas') num mês/ano
 */
async function carregarTransacoes(tipo, mes, ano) {
    try {
        const [ini, fim] = intervaloDoMes(mes, ano);

        const { data, error } = await sb
            .from('transacoes')
            .select('*')
            .eq('tipo', tipo)
            .gte('competencia', ini)
            .lt('competencia', fim)
            .order('data', { ascending: false });

        if (error) throw error;
        return (data || []).map(mapearTransacao);
    } catch (error) {
        console.error('Erro ao carregar transações:', error);
        return [];
    }
}

/**
 * Bolinha de cada mês no calendário do topo: 'passado' (já aconteceu, pelo
 * menos 1 lançamento não pendente com data até hoje) ou 'futuro' (só tem
 * lançamento a confirmar ou com data futura). Agrupa por `competencia`
 * (mesmo critério usado no resto do app pra "em que mês uma transação
 * entra"), olhando `data`/`pendente` só pra decidir se já aconteceu.
 * `iniISO`/`fimISO` (YYYY-MM-01) delimitam a janela de meses visível —
 * intervalo semiaberto [ini, fim).
 */
async function carregarIndicadoresMeses(iniISO, fimISO) {
    try {
        const { data, error } = await sb
            .from('transacoes')
            .select('competencia, data, pendente')
            .gte('competencia', iniISO)
            .lt('competencia', fimISO);
        if (error) throw error;

        const hoje = hojeISO();
        const porMes = {};
        (data || []).forEach(row => {
            const chave = String(row.competencia).slice(0, 7); // 'YYYY-MM'
            const jaAconteceu = !row.pendente && String(row.data).slice(0, 10) <= hoje;
            if (!porMes[chave]) porMes[chave] = { passado: false };
            if (jaAconteceu) porMes[chave].passado = true;
        });
        return porMes;
    } catch (error) {
        console.error('Erro ao carregar indicadores do calendário:', error);
        return {};
    }
}

/**
 * Carrega menus ativos (categorias e métodos) para os dropdowns do formulário
 * Mantém o formato { categorias: [...], metodos: [...] }
 */
async function carregarMenusAPI() {
    try {
        const { data, error } = await sb
            .from('menu_itens')
            .select('*')
            .eq('status', 'Ativo')
            .order('ordem', { ascending: true, nullsFirst: false })
            .order('nome', { ascending: true });

        if (error) throw error;
        const itens = (data || []).map(mapearItemMenu);

        const cats = itens.filter(i => i.tipo === 'Categoria');
        const mapaCor = arr => Object.fromEntries(arr.map(i => [i.nome, corDoItemMenu(i)]));
        const metodos = itens.filter(i => i.tipo === 'Método');
        // Métodos são salvos nas transações pelo rótulo composto (rotuloMetodo:
        // "Crédito Bradesco"), não pelo nome cru do menu_itens ("Crédito -
        // Bradesco") — a cor precisa ser buscada pela mesma chave, senão o
        // gráfico cai no fallback de cor em vez de usar a cor escolhida.
        const mapaCorMetodo = arr => Object.fromEntries(arr.map(i => [rotuloMetodo(i), corDoItemMenu(i)]));
        return {
            categorias: cats.map(i => i.nome),
            categoriasDespesa: cats.filter(c => c.categoriaTipo !== 'entradas').map(i => i.nome),
            categoriasReceita: cats.filter(c => c.categoriaTipo === 'entradas').map(i => i.nome),
            // métodos como objetos (o formulário precisa do tipo/fechamento p/ competência)
            metodos,
            cores: {
                categoria: mapaCor(cats),
                metodo: mapaCorMetodo(metodos)
            }
        };
    } catch (error) {
        console.error('Erro ao carregar menus:', error);
        return { categorias: [], categoriasDespesa: [], categoriasReceita: [], metodos: [], cores: { categoria: {}, metodo: {} } };
    }
}

/**
 * Resumo de um tipo no mês: total + quebra por categoria
 */
async function carregarResumo(tipo, mes, ano) {
    try {
        const [ini, fim] = intervaloDoMes(mes, ano);

        const { data, error } = await sb
            .from('transacoes')
            .select('valor, categoria')
            .eq('tipo', tipo)
            .gte('competencia', ini)
            .lt('competencia', fim);

        if (error) throw error;

        let total = 0;
        const porCat = {};
        (data || []).forEach(r => {
            const v = parseFloat(r.valor) || 0;
            total += v;
            porCat[r.categoria] = (porCat[r.categoria] || 0) + v;
        });

        const porCategoria = Object.entries(porCat)
            .sort((a, b) => b[1] - a[1])
            .map(([categoria, valor]) => ({
                categoria,
                valor: parseFloat(valor.toFixed(2)),
                percentual: total > 0 ? ((valor / total) * 100).toFixed(1) : 0
            }));

        return { mes, ano, total: parseFloat(total.toFixed(2)), porCategoria };
    } catch (error) {
        console.error('Erro ao carregar resumo:', error);
        return { total: 0, porCategoria: [], mes, ano };
    }
}

/**
 * Monta o registro do banco a partir dos dados do formulário. Só existem 2
 * tipos hoje: Pontual (padrão) e Parcelada (compra de crédito dividida —
 * `dia_recorrencia` aqui é o dia de vencimento de cada parcela).
 */
function montarRegistro(dados) {
    const tipoRecorrencia = dados.tipoRecorrencia === 'Parcelada' ? 'Parcelada' : 'Pontual';
    return {
        tipo: dados.tipo,
        data: dados.data,
        valor: parseFloat(dados.valor) || 0,
        metodo: dados.metodo || null,
        categoria: dados.categoria,
        descricao: dados.descricao || '',
        forma_pagamento: dados.formaPagamento || 'À vista',
        tipo_recorrencia: tipoRecorrencia,
        dia_recorrencia: parseInt(dados.diaRecorrencia, 10) || null,
        competencia: dados.competencia || competenciaDe(dados.data),
        status: dados.status || 'Ativa',
        // De onde veio (csv/pdf/pluggy) quando importado — não aparece na UI,
        // null pra lançamento manual. Ver schema.sql:transacoes.origem.
        origem: dados.origem || null,
        // Snapshot "cru" (como veio da fonte, antes do usuário editar
        // categoria/descrição/etc. na revisão) — mesma ideia do origem,
        // invisível na UI. Ver schema.sql:transacoes.dados_originais.
        dados_originais: dados.dadosOriginais || null
    };
}

/**
 * Adiciona nova transação.
 * - Parcelada: uma linha por parcela.
 * - Pontual: uma linha.
 */
async function adicionarTransacaoAPI(dados) {
    if (dados.tipoRecorrencia === 'Parcelada') return adicionarParceladoAPI(dados);

    const { data, error } = await sb
        .from('transacoes')
        .insert(montarRegistro(dados))
        .select()
        .single();

    if (error) throw error;
    return mapearTransacao(data);
}

/** Número formatado sem símbolo: inteiro sem casas, senão 2 casas com vírgula */
function numParcela(x) {
    return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',');
}

/** Valor "original" da parcela `num` (1-based) de um total, com n parcelas */
function valorParcelaOriginal(valorTotal, n, num) {
    const cent = Math.round(valorTotal * 100);
    const base = Math.floor(cent / n);
    const resto = cent - base * n;
    return (base + ((num - 1) < resto ? 1 : 0)) / 100;
}

/** Nome base da descrição de uma parcela (remove "k/n · ..." e sufixos) */
function nomeBaseParcela(descricao) {
    return String(descricao || '').replace(/\s+\d+\/\d+\s+·.*$/, '').trim();
}

/** Monta a descrição de uma parcela: "Nome k/n · vParc/vTotal" */
function descParcela(nome, num, n, valorParc, valorTotal, sufixo) {
    return `${nome} ${num}/${n} · ${numParcela(valorParc)}/${numParcela(valorTotal)}${sufixo ? ' · ' + sufixo : ''}`;
}

async function adicionarParceladoAPI(dados) {
    const n = Math.max(1, parseInt(dados.parcelas, 10) || 1);
    const grupoId = crypto.randomUUID();
    // dados.valor é o valor de CADA parcela; o total é valor x nº de parcelas
    const valorParcela = parseFloat(dados.valor) || 0;
    const total = Math.round(valorParcela * n * 100) / 100;

    const base = montarRegistro(dados);
    base.grupo_id = grupoId;
    base.parcelas_total = n;
    base.valor_total = total;

    const registros = [];
    for (let i = 0; i < n; i++) {
        const num = i + 1;
        const valor = valorParcelaOriginal(total, n, num);
        const competencia = i === 0 ? base.competencia : addMeses(base.competencia, i);
        // Com dia de vencimento informado, cada parcela cai nesse dia (ajustado
        // pro próximo dia útil); sem ele, cada parcela é 1 mês depois da anterior.
        const data = i === 0 ? base.data
            : (base.dia_recorrencia ? dataVencimento(competencia, base.dia_recorrencia) : addMeses(base.data, i));
        registros.push({
            ...base,
            valor,
            parcela_num: num,
            data,
            competencia,
            descricao: dados.descricao || ''   // exatamente o que o usuário digitou
        });
    }

    const { data, error } = await sb.from('transacoes').insert(registros).select();
    if (error) throw error;
    return (data || []).map(mapearTransacao);
}

/**
 * Quita (ou desfaz a quitação de) um parcelamento a partir da parcela `id`.
 * quitar=true: a parcela do mês recebe o saldo restante; as seguintes zeram,
 * ficam marcadas como quitadas e indicam o mês da quitação.
 * quitar=false: restaura os valores originais de todas as parcelas do grupo.
 */
async function quitarParcelamentoAPI(id, quitar) {
    const { data: alvo, error: e1 } = await sb.from('transacoes')
        .select('grupo_id, competencia, parcela_num, parcelas_total, valor_total, tipo_recorrencia')
        .eq('id', id).single();
    if (e1) throw e1;
    if (!alvo.grupo_id || alvo.tipo_recorrencia !== 'Parcelada') throw new Error('Não é um parcelamento');

    const { data: rows, error: e2 } = await sb.from('transacoes')
        .select('id, parcela_num')
        .eq('grupo_id', alvo.grupo_id).order('parcela_num');
    if (e2) throw e2;

    const n = alvo.parcelas_total || rows.length;
    const total = alvo.valor_total;

    let updates;
    if (quitar) {
        const k = alvo.parcela_num;
        const saldo = rows.filter(r => r.parcela_num >= k)
            .reduce((s, r) => s + valorParcelaOriginal(total, n, r.parcela_num), 0);
        const saldoR = Math.round(saldo * 100) / 100;

        updates = rows.filter(r => r.parcela_num >= k).map(r => r.parcela_num === k
            ? { id: r.id, patch: { valor: saldoR, quitada: false, quitado_em: alvo.competencia } }
            : { id: r.id, patch: { valor: 0, quitada: true, quitado_em: alvo.competencia } });
    } else {
        updates = rows.map(r => ({
            id: r.id,
            patch: {
                valor: valorParcelaOriginal(total, n, r.parcela_num),
                quitada: false, quitado_em: null
            }
        }));
    }

    for (const u of updates) {
        const { error } = await sb.from('transacoes').update(u.patch).eq('id', u.id);
        if (error) throw error;
    }
    return { mensagem: quitar ? 'Parcelamento quitado' : 'Quitação desfeita' };
}

/**
 * Edita uma transação (Pontual ou uma parcela individual de uma Parcelada —
 * edita só a parcela em questão, as outras da série não são tocadas).
 */
async function editarTransacaoAPI(dados) {
    if (!dados.id) throw new Error('ID é obrigatório para editar');

    const registro = montarRegistro(dados);
    delete registro.tipo;
    // origem/dados_originais são gravados só na criação (import) — editar um
    // lançamento pelo formulário normal nunca passa esses campos em `dados`,
    // então sem isto cada edição apagava o registro de origem/snapshot cru.
    delete registro.origem;
    delete registro.dados_originais;

    const { data, error } = await sb.from('transacoes')
        .update(registro).eq('id', dados.id).select().single();
    if (error) throw error;

    return mapearTransacao(data);
}

/**
 * Deleta uma transação. Parcelada: só a 1ª parcela pode ser apagada, e apaga
 * todas as parcelas da série junto.
 */
async function deletarTransacaoAPI(id) {
    const { data: alvo, error: e1 } = await sb
        .from('transacoes')
        .select('grupo_id, tipo_recorrencia, parcela_num')
        .eq('id', id).single();
    if (e1) throw e1;

    // Parcelamento: só a 1ª parcela pode ser apagada (e apaga todas)
    if (alvo.tipo_recorrencia === 'Parcelada' && alvo.grupo_id) {
        if ((alvo.parcela_num || 1) !== 1) {
            const { data: orig } = await sb.from('transacoes').select('competencia')
                .eq('grupo_id', alvo.grupo_id).eq('parcela_num', 1).single();
            const err = new Error('Só a primeira parcela pode ser apagada.');
            err.detalhe = { tipo: 'parcela-nao-original', competenciaOriginal: orig?.competencia || alvo.competencia };
            throw err;
        }
        const { error } = await sb.from('transacoes').delete().eq('grupo_id', alvo.grupo_id);
        if (error) throw error;
        return { mensagem: 'Parcelamento removido' };
    }

    const { error } = await sb.from('transacoes').delete().eq('id', id);
    if (error) throw error;
    return { mensagem: 'Transação removida' };
}
