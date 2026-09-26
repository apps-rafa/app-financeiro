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
const CATEGORIAS_RECEITA_SEED = ['Salário', 'Bônus', '13º', 'PL', 'Freelance', CATEGORIA_ESTORNO, CATEGORIA_REEMBOLSO, CATEGORIA_DINHEIRO_RECEITA];

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
            { tipo: 'Método', nome: 'PIX', metodo_kind: 'PIX', cor: cor('PIX') }
        ];

        // Usuário de teste (login anônimo, "Testar sem cadastro"): já entra
        // com um cartão de crédito genérico cadastrado, pra não precisar
        // criar um na mão só pra testar o fluxo de Crédito/parcelamento.
        let ehAnonimo = false;
        try {
            const { data } = await sb.auth.getUser();
            ehAnonimo = !!data?.user?.is_anonymous;
        } catch (_) {}
        if (ehAnonimo) {
            linhas.push({
                tipo: 'Método', nome: 'Crédito — Genérico', metodo_kind: 'Crédito', banco: 'Genérico',
                dia_fechamento: 20, dia_vencimento: 27, cor: cor('Crédito — Genérico')
            });
        }

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
 * Garante que existem as categorias de receita fixas "Estorno", "Reembolso"
 * e "Dinheiro". Para usuários antigos que já tinham a lista de categorias
 * antes delas existirem (ou que só tinham a antiga "Reembolso/Estorno").
 */
async function garantirCategoriaReembolsoNoBanco() {
    if (_categoriaReembolsoGarantida) return;
    try {
        const fixas = [CATEGORIA_ESTORNO, CATEGORIA_REEMBOLSO, CATEGORIA_DINHEIRO_RECEITA];
        const { data, error } = await sb.from('menu_itens')
            .select('nome').eq('tipo', 'Categoria').eq('categoria_tipo', 'entradas')
            .in('nome', fixas);
        if (error) throw error;
        const existentes = new Set((data || []).map(r => r.nome));
        const faltando = fixas.filter(n => !existentes.has(n));
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
    // O tipo "PIX/Débito" aparece só como "PIX" (o valor interno do tipo não muda)
    const tipo = item.metodoKind === 'PIX/Débito' ? 'PIX' : item.metodoKind;
    if (item.banco) return `${tipo} ${item.banco}`;
    // Sem banco (o PIX "base"): o nome cadastrado vale por si — editável em
    // Configurações > Formas de pagamento, mesmo esse método não podendo
    // ser removido. Sem edição nenhuma, item.nome já é "PIX" (do seed).
    return item.nome || tipo;
}

/** "Mercado Pago" -> "M. Pago" (2+ palavras: inicial de cada uma, menos a
 *  última, que fica por extenso). Banco de 1 palavra só (ex. "Bradesco")
 *  volta como veio — quem encurta esse caso é rotuloMetodoNiveis(). */
function _abreviarBanco(banco) {
    const partes = String(banco).trim().split(/\s+/);
    if (partes.length < 2) return banco;
    return partes.slice(0, -1).map(p => p[0].toUpperCase() + '.').join(' ') + ' ' + partes[partes.length - 1];
}

/** 3 níveis do rótulo de um método, do mais completo ao mais curto — pros
 *  lugares (chip da lista, principalmente) onde o espaço aperta:
 *    "Crédito Bradesco" -> "CC Bradesco" -> "CC Brad."
 *    "PIX Mercado Pago"  -> "PIX M. Pago" (já cabe, os 2 níveis ficam iguais)
 *  Dinheiro/PIX sem banco não têm o que encurtar — os 3 níveis saem iguais. */
function rotuloMetodoNiveis(item) {
    const full = rotuloMetodo(item);
    if (!item.metodoKind || item.metodoKind === 'Dinheiro' || !item.banco) {
        return { full, media: full, curto: full };
    }
    const tipo = item.metodoKind === 'PIX/Débito' ? 'PIX' : (item.metodoKind === 'Crédito' ? 'CC' : item.metodoKind);
    const bancoMedio = _abreviarBanco(item.banco);
    const bancoCurto = bancoMedio !== item.banco ? bancoMedio : (item.banco.length > 5 ? item.banco.slice(0, 4) + '.' : item.banco);
    return { full, media: `${tipo} ${bancoMedio}`, curto: `${tipo} ${bancoCurto}` };
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
        // Lançamentos guardam o NOME (método/categoria) como texto: se o nome/rótulo mudar,
        // os lançamentos antigos (e a fila de revisão) precisam acompanhar.
        const { data: antes } = await sb.from('menu_itens').select('*').eq('id', linha).maybeSingle();
        const { error } = await sb.from('menu_itens').update(campos).eq('id', linha);
        if (error) throw error;
        if (antes) await _propagarRenomeacaoMenu(antes, linha);
        mostrarNotificacao('Item atualizado com sucesso!', 'sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao atualizar item:', error);
        mostrarNotificacao('Erro ao atualizar item', 'erro');
        return false;
    }
}

async function _recarregarAposRenomear() {
    if (typeof recarregarDados === 'function') await recarregarDados(); // os chips antigos acompanham o novo nome
    if (typeof atualizarUI === 'function') atualizarUI();
}

/** Depois de editar um item de menu: se o rótulo mudou, atualiza os lançamentos que usam o rótulo antigo. */
async function _propagarRenomeacaoMenu(antes, linha) {
    try {
        const { data: depois } = await sb.from('menu_itens').select('*').eq('id', linha).maybeSingle();
        if (!depois) return;
        const ant = mapearItemMenu(antes), dep = mapearItemMenu(depois);
        if (antes.tipo === 'Método') {
            const velho = rotuloMetodo(ant), novo = rotuloMetodo(dep);
            if (velho && novo && velho !== novo) {
                const { error } = await sb.from('transacoes').update({ metodo: novo }).eq('metodo', velho);
                if (error) console.error('Erro ao atualizar lançamentos da forma de pagamento:', error);
                else await _recarregarAposRenomear();
            }
        } else if (antes.tipo === 'Categoria') {
            if (ant.nome && dep.nome && ant.nome !== dep.nome) {
                const { error } = await sb.from('transacoes').update({ categoria: dep.nome }).eq('categoria', ant.nome);
                if (error) console.error('Erro ao atualizar lançamentos da categoria:', error);
                await sb.from('transacoes_importadas').update({ categoria_sugerida: dep.nome }).eq('categoria_sugerida', ant.nome);
                if (!error) await _recarregarAposRenomear();
            }
        }
    } catch (e) {
        console.error('Falha ao propagar renomeação do menu:', e);
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
