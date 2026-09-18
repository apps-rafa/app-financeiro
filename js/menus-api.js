/**
 * API DE MENUS - SUPABASE
 * Gerencia categorias e métodos (tabela menu_itens).
 * Mantém as assinaturas usadas por js/menus-ui.js.
 * "linha" nas funções abaixo = coluna id (bigint) da tabela.
 */

// Conjunto padrão criado para cada novo usuário (inclui visitantes).
// Categorias são separadas por tipo de transação: despesa (saidas) x receita (entradas).
const CATEGORIAS_DESPESA_SEED = ['Alimentação', 'Alimentação app', 'Assinaturas', 'Contas',
    'Compras', 'Compras online', 'Lazer', 'Mercado', 'Saúde', 'Serviços',
    'Transporte app', 'Transporte'];
const CATEGORIAS_RECEITA_SEED = ['Salário', 'Bônus', '13º', 'PL', 'Freelance', CATEGORIA_ESTORNO, CATEGORIA_REEMBOLSO];

/**
 * Se o usuário atual ainda não tem nenhum item de menu, cria o conjunto padrão.
 * Chamado no primeiro carregamento (novo usuário ou visitante).
 */
async function semearMenusPadraoSeVazio() {
    try {
        const { count, error } = await sb
            .from('menu_itens')
            .select('id', { count: 'exact', head: true });
        if (error) throw error;
        if (count && count > 0) return false;

        const cor = n => (typeof corPadraoChip === 'function' ? corPadraoChip(n) : null);
        const linhas = [
            ...CATEGORIAS_DESPESA_SEED.map(nome => ({ tipo: 'Categoria', nome, categoria_tipo: 'saidas', cor: cor(nome) })),
            ...CATEGORIAS_RECEITA_SEED.map(nome => ({ tipo: 'Categoria', nome, categoria_tipo: 'entradas', cor: cor(nome) })),
            { tipo: 'Método', nome: 'Dinheiro', metodo_kind: 'Dinheiro', cor: cor('Dinheiro') },
            { tipo: 'Método', nome: 'PIX/Débito', metodo_kind: 'PIX/Débito', cor: cor('PIX/Débito') }
        ];
        const { error: insErr } = await sb.from('menu_itens').insert(linhas);
        if (insErr) throw insErr;
        console.log('🌱 Menus padrão criados para o usuário');
        return true;
    } catch (error) {
        console.error('Erro ao semear menus padrão:', error);
        return false;
    }
}

let _categoriaReembolsoGarantida = false;
/**
 * Garante que existem as categorias de receita fixas "Estorno" e
 * "Reembolso". Para usuários antigos que já tinham a lista de categorias
 * antes delas existirem (ou que só tinham a antiga "Reembolso/Estorno").
 */
async function garantirCategoriaReembolsoNoBanco() {
    if (_categoriaReembolsoGarantida) return;
    try {
        const { data, error } = await sb.from('menu_itens')
            .select('nome').eq('tipo', 'Categoria').eq('categoria_tipo', 'entradas')
            .in('nome', [CATEGORIA_ESTORNO, CATEGORIA_REEMBOLSO]);
        if (error) throw error;
        const existentes = new Set((data || []).map(r => r.nome));
        const faltando = [CATEGORIA_ESTORNO, CATEGORIA_REEMBOLSO].filter(n => !existentes.has(n));
        if (faltando.length) {
            const cor = n => (typeof corPadraoChip === 'function' ? corPadraoChip(n) : null);
            await sb.from('menu_itens').insert(
                faltando.map(nome => ({ tipo: 'Categoria', nome, categoria_tipo: 'entradas', cor: cor(nome) }))
            );
        }
        _categoriaReembolsoGarantida = true;
    } catch (e) {
        console.error('Erro ao garantir categorias de estorno/reembolso no banco:', e);
    }
}

function mapearItemMenu(row) {
    return {
        linha: row.id,
        id: row.id,
        tipo: row.tipo,
        nome: row.nome,
        descricao: row.descricao || '',
        status: row.status || 'Ativo',
        cor: row.cor || null,
        categoriaTipo: row.categoria_tipo || null,   // 'saidas' | 'entradas' (só Categoria)
        metodoKind: row.metodo_kind || null,
        banco: row.banco || '',
        diaFechamento: row.dia_fechamento || null,
        diaVencimento: row.dia_vencimento || null,
        melhorDiaCompra: row.melhor_dia_compra || null,
        ordem: row.ordem ?? null   // posição manual na lista (menor = mais acima)
    };
}

/** Rótulo mostrado no dropdown do formulário para um método */
function rotuloMetodo(item) {
    if (!item.metodoKind || item.metodoKind === 'Dinheiro') return item.nome;
    return item.banco ? `${item.metodoKind} ${item.banco}` : item.metodoKind;
}

/**
 * Carrega todos os itens (ativos e inativos), agrupados por tipo.
 */
async function carregarMenusCompleto() {
    try {
        await garantirCategoriaReembolsoNoBanco();
        const { data, error } = await sb
            .from('menu_itens')
            .select('*')
            .order('ordem', { ascending: true, nullsFirst: false })
            .order('nome', { ascending: true });

        if (error) throw error;

        const itens = (data || []).map(mapearItemMenu);
        const categorias = itens.filter(i => i.tipo === 'Categoria');
        return {
            categorias,
            categoriasDespesa: categorias.filter(c => c.categoriaTipo !== 'entradas'),
            categoriasReceita: categorias.filter(c => c.categoriaTipo === 'entradas'),
            metodos: itens.filter(i => i.tipo === 'Método')
        };
    } catch (error) {
        console.error('Erro ao carregar menus:', error);
        mostrarNotificacao('Erro ao carregar menus', 'erro');
        return null;
    }
}

/**
 * Itens de um tipo específico ('Categoria' | 'Método' | 'Recorrência')
 */
async function obterItensPorTipo(tipo) {
    try {
        const { data, error } = await sb
            .from('menu_itens')
            .select('*')
            .eq('tipo', tipo)
            .order('nome', { ascending: true });

        if (error) throw error;
        return (data || []).map(mapearItemMenu);
    } catch (error) {
        console.error('Erro ao obter itens:', error);
        return null;
    }
}

/**
 * Adiciona novo item ao menu.
 * @param {string} tipo   'Categoria' | 'Método' | 'Recorrência'
 * @param {string} nome
 * @param {object} extra  campos opcionais: descricao, metodo_kind, banco,
 *                        dia_fechamento, dia_vencimento, melhor_dia_compra
 */
async function adicionarItemMenuAPI(tipo, nome, extra = {}) {
    try {
        // Novo item entra no fim da lista (maior ordem do grupo + 1), a
        // menos que já tenha vindo com uma ordem explícita.
        let ordem = extra.ordem;
        if (ordem == null) {
            let query = sb.from('menu_itens').select('ordem').eq('tipo', tipo);
            query = extra.categoria_tipo
                ? query.eq('categoria_tipo', extra.categoria_tipo)
                : query.is('categoria_tipo', null);
            const { data: existentes } = await query.order('ordem', { ascending: false }).limit(1);
            ordem = (existentes && existentes[0] && existentes[0].ordem != null) ? existentes[0].ordem + 1 : 1;
        }

        const { error } = await sb
            .from('menu_itens')
            .insert({ tipo, nome, ordem, ...extra });

        if (error) throw error;
        mostrarNotificacao(`${nome} adicionado com sucesso!`, 'sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao adicionar item:', error);
        const msg = error.code === '23505' ? 'Item já existe' : 'Erro ao adicionar item';
        mostrarNotificacao(msg, 'erro');
        return false;
    }
}

/**
 * Edita um item existente. `campos` = objeto com o que mudar
 * (nome, descricao, status, banco, dia_fechamento, ...).
 */
async function editarItemMenuAPI(linha, campos) {
    try {
        const { error } = await sb.from('menu_itens').update(campos).eq('id', linha);
        if (error) throw error;
        mostrarNotificacao('Item atualizado com sucesso!', 'sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao atualizar item:', error);
        mostrarNotificacao('Erro ao atualizar item', 'erro');
        return false;
    }
}

/**
 * Remove um item (delete definitivo)
 */
async function removerItemMenuAPI(linha) {
    try {
        const { error } = await sb.from('menu_itens').delete().eq('id', linha);
        if (error) throw error;
        mostrarNotificacao('Item removido com sucesso!', 'sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao remover item:', error);
        mostrarNotificacao('Erro ao remover item', 'erro');
        return false;
    }
}

/**
 * Desativa um item (status = Inativo)
 */
async function desativarItemMenuAPI(linha) {
    return _mudarStatusItem(linha, 'Inativo', 'Item desativado com sucesso!');
}

/**
 * Ativa um item (status = Ativo)
 */
async function ativarItemMenuAPI(linha) {
    return _mudarStatusItem(linha, 'Ativo', 'Item ativado com sucesso!');
}

/**
 * Salva uma nova ordem pra vários itens de uma vez (reordenar manual ou
 * "A→Z"). Sem notificação por item — só uma, no fim, feita por quem chama.
 * @param {{id:number, ordem:number}[]} atualizacoes
 */
async function salvarOrdemMenuAPI(atualizacoes) {
    try {
        for (const { id, ordem } of atualizacoes) {
            const { error } = await sb.from('menu_itens').update({ ordem }).eq('id', id);
            if (error) throw error;
        }
        return true;
    } catch (error) {
        console.error('Erro ao salvar ordem:', error);
        mostrarNotificacao('Erro ao salvar a ordem', 'erro');
        return false;
    }
}

async function _mudarStatusItem(linha, status, msgOk) {
    try {
        const { error } = await sb.from('menu_itens').update({ status }).eq('id', linha);
        if (error) throw error;
        mostrarNotificacao(msgOk, 'sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao mudar status do item:', error);
        mostrarNotificacao('Erro ao atualizar item', 'erro');
        return false;
    }
}
