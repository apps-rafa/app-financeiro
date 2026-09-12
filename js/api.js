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
 * Recorrentes que ainda vão acontecer NO MÊS em exibição (a partir de hoje,
 * quando o mês exibido é o corrente).
 */
async function carregarProximas(tipo, mes, ano) {
    try {
        const agora = new Date();
        const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
        const y = ano || agora.getFullYear();
        const m = mes || (agora.getMonth() + 1);
        const ini = new Date(y, m - 1, 1);
        const fim = new Date(y, m, 0);              // último dia do mês
        const de = ini > hoje ? ini : hoje;        // não mostra o que já passou
        if (fim < de) return [];                    // mês já encerrado

        const { data, error } = await sb
            .from('transacoes')
            .select('*')
            .eq('tipo', tipo)
            .neq('tipo_recorrencia', 'Pontual')
            .gte('data', formatarDataISO(de))
            .lte('data', formatarDataISO(fim))
            .order('data', { ascending: true });

        if (error) throw error;
        return (data || []).map(mapearTransacao);
    } catch (error) {
        console.error('Erro ao carregar próximas:', error);
        return [];
    }
}

/**
 * Carrega menus ativos (categorias e métodos) para os dropdowns do formulário
 * Mantém o formato { categorias: [...], metodos: [...] }
 */
async function carregarMenusAPI() {
    try {
        if (typeof garantirRecorrenciasNoBanco === 'function') await garantirRecorrenciasNoBanco();
        const { data, error } = await sb
            .from('menu_itens')
            .select('*')
            .eq('status', 'Ativo')
            .order('ordem', { ascending: true, nullsFirst: false })
            .order('nome', { ascending: true });

        if (error) throw error;
        const itens = (data || []).map(mapearItemMenu);

        const cats = itens.filter(i => i.tipo === 'Categoria');
        const recs = itens.filter(i => i.tipo === 'Recorrência');
        const mapaCor = arr => Object.fromEntries(arr.map(i => [i.nome, corDoItemMenu(i)]));
        return {
            categorias: cats.map(i => i.nome),
            categoriasDespesa: cats.filter(c => c.categoriaTipo !== 'entradas').map(i => i.nome),
            categoriasReceita: cats.filter(c => c.categoriaTipo === 'entradas').map(i => i.nome),
            // métodos como objetos (o formulário precisa do tipo/fechamento p/ competência)
            metodos: itens.filter(i => i.tipo === 'Método'),
            recorrencias: recs.map(i => i.nome),
            cores: {
                categoria: mapaCor(cats),
                metodo: mapaCor(itens.filter(i => i.tipo === 'Método')),
                recorrencia: mapaCor(recs)
            }
        };
    } catch (error) {
        console.error('Erro ao carregar menus:', error);
        return { categorias: [], categoriasDespesa: [], categoriasReceita: [], metodos: [], cores: { categoria: {}, metodo: {}, recorrencia: {} } };
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
 * Monta o registro do banco a partir dos dados do formulário
 */
function montarRegistro(dados) {
    const tipoRecorrencia = dados.tipoRecorrencia || 'Pontual';
    const reg = {
        tipo: dados.tipo,
        data: dados.data,
        valor: parseFloat(dados.valor) || 0,
        metodo: dados.metodo || null,
        categoria: dados.categoria,
        descricao: dados.descricao || '',
        forma_pagamento: dados.formaPagamento || 'À vista',
        tipo_recorrencia: tipoRecorrencia,
        dia_recorrencia: parseInt(dados.diaRecorrencia, 10) || null,
        dia_semana: dados.diaSemana === '' || dados.diaSemana == null ? null : parseInt(dados.diaSemana, 10),
        proxima_data: calcularProximaData(dados.data, tipoRecorrencia, dados.diaRecorrencia, dados.diaSemana),
        competencia: dados.competencia || competenciaDe(dados.data),
        status: dados.status || 'Ativa',
        pagar_no_vencimento: !!dados.pagarVencimento
    };

    // "Pagar no vencimento" (Mensal/Parcelada): data do lançamento = data de vencimento
    if (reg.pagar_no_vencimento && (tipoRecorrencia === 'Mensal' || tipoRecorrencia === 'Parcelada')) {
        const venc = dataVencimento(reg.competencia, reg.dia_recorrencia);
        if (venc) reg.data = venc;
    }

    // Semanal com dia fixo: valor por sessão + semanas marcadas; valor gravado = X
    const semanas = Array.isArray(dados.semanas) ? dados.semanas.slice().sort() : [];
    if (tipoRecorrencia === 'Semanal' && semanas.length) {
        const vs = parseFloat(dados.valorSessao ?? dados.valor) || 0;
        const hoje = hojeISO();
        reg.valor_sessao = vs;
        reg.semanas = semanas;
        reg.valor_total = semanas.length * vs;                        // Y
        reg.valor = semanas.filter(d => d <= hoje).length * vs;       // X
    }

    // "Dia útil fixo": a data sai da competência (o tipo "... do mês anterior"
    // cai no mês anterior, mantendo a competência do mês escolhido)
    if (RECORRENCIA_DIA_UTIL.includes(tipoRecorrencia) && reg.competencia) {
        reg.data = dataDiaUtilPorCompetencia(reg.competencia, tipoRecorrencia);
        reg.proxima_data = calcularProximaData(reg.data, tipoRecorrencia);
    }

    // Receita Mensal/Parcelada: a data é sempre o dia informado no próximo dia útil
    if (reg.tipo === 'entradas' && (tipoRecorrencia === 'Mensal' || tipoRecorrencia === 'Parcelada')
        && reg.competencia) {
        reg.data = dataReceitaMensal(reg.competencia, reg.dia_recorrencia);
        reg.proxima_data = calcularProximaData(reg.data, tipoRecorrencia, reg.dia_recorrencia);
    }
    return reg;
}

// Tipos que se repetem "rolando" um mês por vez (mês atual + 1 pendente)
const RECORRENTES = ['Mensal', 'Semanal', 'Último dia útil do mês',
    'Último dia útil do mês anterior', 'Primeiro dia útil do mês', 'Até o 5º dia útil do mês'];

// Tipo cujo lançamento já nasce pendente e se auto-confirma no 5º dia útil
const AUTO_CONFIRMA = 'Até o 5º dia útil do mês';

/**
 * Adiciona nova transação.
 * - Parcelada: uma linha por parcela.
 * - Mensal / Semanal / dia útil: mês atual (confirmado) + próximo mês (pendente).
 * - Pontual: uma linha.
 */
async function adicionarTransacaoAPI(dados) {
    if (dados.tipoRecorrencia === 'Parcelada') return adicionarParceladoAPI(dados);
    if (RECORRENTES.includes(dados.tipoRecorrencia)) return adicionarRecorrenteAPI(dados);

    const { data, error } = await sb
        .from('transacoes')
        .insert(montarRegistro(dados))
        .select()
        .single();

    if (error) throw error;
    return mapearTransacao(data);
}

/** Próxima "data base" para o mês seguinte de uma série recorrente */
function proximaDataRecorrente(row) {
    if (row.tipo_recorrencia === 'Semanal' && row.dia_semana != null) {
        return primeiraOcorrenciaProxMes(row.data, row.dia_semana);
    }
    return calcularProximaData(row.data, row.tipo_recorrencia, row.dia_recorrencia, row.dia_semana);
}

/** Clona os campos de negócio de uma linha para gerar a próxima ocorrência (mês seguinte, pendente) */
function ocorrenciaSeguinte(row, novaData) {
    const base = {
        tipo: row.tipo,
        valor: row.valor,
        metodo: row.metodo,
        categoria: row.categoria,
        descricao: row.descricao,
        forma_pagamento: row.forma_pagamento,
        tipo_recorrencia: row.tipo_recorrencia,
        dia_recorrencia: row.dia_recorrencia,
        dia_semana: row.dia_semana,
        pagar_no_vencimento: row.pagar_no_vencimento,
        status: row.status,
        grupo_id: row.grupo_id,
        data: novaData,
        competencia: competenciaDe(novaData),
        proxima_data: null,
        pendente: true
    };

    // "Dia útil fixo": avança a competência 1 mês e recalcula a data
    if (RECORRENCIA_DIA_UTIL.includes(row.tipo_recorrencia) && row.competencia) {
        const proxComp = addMeses(row.competencia, 1);
        base.competencia = proxComp;
        base.data = dataDiaUtilPorCompetencia(proxComp, row.tipo_recorrencia);
    }

    // Receita Mensal: competência +1 mês, data no dia informado / próximo dia útil
    if (row.tipo === 'entradas' && row.tipo_recorrencia === 'Mensal' && row.competencia) {
        const proxComp = addMeses(row.competencia, 1);
        base.competencia = proxComp;
        base.data = dataReceitaMensal(proxComp, row.dia_recorrencia);
    }

    // Semanal: o mês seguinte vem com TODAS as suas ocorrências marcadas (nada passou ainda)
    if (row.tipo_recorrencia === 'Semanal' && row.dia_semana != null && row.valor_sessao != null) {
        const d = parseDataLocal(novaData);
        const semanas = ocorrenciasDoDiaNoMes(d.getFullYear(), d.getMonth(), row.dia_semana);
        const vs = parseFloat(row.valor_sessao);
        base.valor_sessao = vs;
        base.semanas = semanas;
        base.valor_total = semanas.length * vs;
        base.valor = 0;
    }
    return base;
}

async function adicionarRecorrenteAPI(dados) {
    const grupoId = crypto.randomUUID();
    const ehAuto = dados.tipoRecorrencia === AUTO_CONFIRMA;
    const atual = { ...montarRegistro(dados), grupo_id: grupoId, pendente: ehAuto };

    const proxData = proximaDataRecorrente(atual);
    atual.proxima_data = proxData || null;

    const registros = [atual];
    // Auto-confirma: nasce pendente e sem "próximo mês"; o seguinte é criado ao confirmar.
    if (!ehAuto && proxData) registros.push(ocorrenciaSeguinte(atual, proxData));

    const { data, error } = await sb.from('transacoes').insert(registros).select();
    if (error) throw error;
    return (data || []).map(mapearTransacao);
}

/**
 * Auto-confirma os lançamentos "Até o 5º dia útil do mês" pendentes cujo
 * 5º dia útil da competência já passou. Roda no carregamento.
 */
async function autoConfirmarVencidos() {
    for (let i = 0; i < 24; i++) {
        const { data: pend, error } = await sb.from('transacoes')
            .select('id, data')
            .eq('tipo_recorrencia', AUTO_CONFIRMA)
            .eq('pendente', true);
        if (error || !pend || !pend.length) return;

        const hoje = hojeISO();
        // A própria data já é o 5º dia útil alvo (antecipado ou não)
        const vencidas = pend.filter(p => p.data && p.data <= hoje);
        if (!vencidas.length) return;

        for (const p of vencidas) await confirmarPendenteAPI(p.id);
    }
}

/**
 * Confirma uma ocorrência pendente: marca como confirmada e cria a próxima
 * (mês seguinte) também pendente.
 */
async function confirmarPendenteAPI(id) {
    const { data: row, error: e1 } = await sb
        .from('transacoes').select('*').eq('id', id).single();
    if (e1) throw e1;

    const proxData = proximaDataRecorrente(row);

    const { error: e2 } = await sb.from('transacoes')
        .update({ pendente: false, proxima_data: proxData || null })
        .eq('id', id);
    if (e2) throw e2;

    if (proxData && row.grupo_id) {
        const { error: e3 } = await sb.from('transacoes').insert(ocorrenciaSeguinte(row, proxData));
        if (e3) throw e3;
    }
    return { mensagem: 'Confirmado' };
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
        registros.push({
            ...base,
            valor,
            parcela_num: num,
            data: i === 0 ? base.data
                : (base.tipo === 'entradas'
                    ? dataReceitaMensal(addMeses(base.competencia, i), base.dia_recorrencia)
                    : addMeses(base.data, i)),
            competencia: i === 0 ? base.competencia : addMeses(base.competencia, i),
            // próxima data = data REAL da parcela seguinte (não o 1º dia da competência)
            proxima_data: i < n - 1
                ? (base.tipo === 'entradas'
                    ? dataReceitaMensal(addMeses(base.competencia, i + 1), base.dia_recorrencia)
                    : addMeses(base.data, i + 1))
                : null,
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

// Campos "de negócio" que uma edição propaga para a ocorrência pendente da série
const CAMPOS_CASCATA = ['valor', 'metodo', 'categoria', 'descricao',
    'dia_recorrencia', 'dia_semana', 'forma_pagamento'];

/**
 * Edita uma transação. Se faz parte de uma série (grupo_id), a alteração dos
 * campos de negócio também é aplicada à ocorrência pendente (o "mês seguinte"),
 * desde que ela seja posterior. Meses já confirmados não são tocados.
 */
async function editarTransacaoAPI(dados) {
    if (!dados.id) throw new Error('ID é obrigatório para editar');

    const { data: alvo, error: e1 } = await sb
        .from('transacoes')
        .select('grupo_id, competencia, pendente')
        .eq('id', dados.id)
        .single();
    if (e1) throw e1;

    const registro = montarRegistro(dados);
    delete registro.tipo;

    const { data, error } = await sb.from('transacoes')
        .update(registro).eq('id', dados.id).select().single();
    if (error) throw error;

    // Editar e salvar uma ocorrência recorrente PENDENTE já vale como "OK":
    // confirma o mês e gera o próximo pendente.
    if (alvo.pendente && alvo.grupo_id && RECORRENTES.includes(registro.tipo_recorrencia)) {
        await confirmarPendenteAPI(dados.id);
        return { mensagem: 'Alterações salvas e mês confirmado' };
    }

    // Propaga para o pendente da série (não para Semanal: cada mês tem seus chips)
    if (alvo.grupo_id && !alvo.pendente && registro.tipo_recorrencia !== 'Semanal') {
        const patch = {};
        CAMPOS_CASCATA.forEach(k => { if (k in registro) patch[k] = registro[k]; });
        await sb.from('transacoes')
            .update(patch)
            .eq('grupo_id', alvo.grupo_id)
            .eq('pendente', true)
            .gt('competencia', alvo.competencia);
    }

    return mapearTransacao(data);
}

/**
 * Deleta uma transação. Se faz parte de uma série, também remove a ocorrência
 * pendente (encerra a repetição). Meses já confirmados permanecem.
 */
async function deletarTransacaoAPI(id) {
    const { data: alvo, error: e1 } = await sb
        .from('transacoes')
        .select('grupo_id, competencia, tipo_recorrencia, parcela_num')
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

    if (alvo.grupo_id) {
        await sb.from('transacoes').delete()
            .eq('grupo_id', alvo.grupo_id)
            .eq('pendente', true)
            .gte('competencia', alvo.competencia);
    }
    return { mensagem: 'Transação removida' };
}
