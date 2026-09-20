/**
 * UI DE CONFIGURAÇÃO
 * Categorias, Métodos de pagamento (inclui cartões).
 */

let menusAtual = null; // cache dos itens carregados (para edição inline)
let subConfigAtiva = null; // sub-aba selecionada na Configuração — nenhuma por padrão (toggle)

/** Recarrega a aba de configuração e, em seguida, os dropdowns do formulário */
async function recarregarMenus() {
  await carregarAbaMenus();
  if (typeof carregarMenus === 'function') await carregarMenus(); // atualiza form na hora
  if (typeof atualizarUI === 'function') atualizarUI();           // reaplica cores nas listas
}

async function carregarAbaMenus() {
  const menus = await carregarMenusCompleto();
  menusAtual = menus;

  if (!menus) {
    document.querySelector(SELECTORS.menusContainer).innerHTML =
      '<p class="empty-state">Erro ao carregar configuração</p>';
    return;
  }

  // innerHTML é recriado do zero a cada chamada (adicionar/reordenar item
  // chama recarregarMenus()) — sem isso, os <details> das colunas de
  // categoria e dos grupos de feriado voltavam sempre pro estado fechado
  // (padrão de um <details> novo), mesmo que o usuário tivesse aberto.
  const estadoAberto = {};
  document.querySelectorAll(`${SELECTORS.menusContainer} details[data-cat-tipo], ${SELECTORS.menusContainer} details[data-fer-cat]`)
    .forEach(d => { estadoAberto[d.dataset.catTipo || `fer-${d.dataset.ferCat}`] = d.open; });

  document.querySelector(SELECTORS.menusContainer).innerHTML = `
    <div class="menus-gerenciamento">

      <div class="subtabs" role="tablist">
        <div class="subtabs-itens">
          <button class="subtab" data-sub="cat">🏷️ <span class="subtab-texto">Categorias</span></button>
          <button class="subtab" data-sub="met">💳
            <span class="subtab-texto met-full">Formas de pagamento</span>
            <span class="subtab-texto met-curto">Pgtos.</span>
          </button>
          <button class="subtab" data-sub="fer">📅 <span class="subtab-texto">Feriados</span></button>
          <button class="subtab" data-sub="of">🏦 <span class="subtab-texto">Open Finance</span></button>
          <button class="subtab" data-sub="dados">💾 <span class="subtab-texto">Dados</span></button>
        </div>
      </div>

      <div class="menu-section menu-section--cols" data-sub="cat" hidden>
        <details class="cat-coluna" data-cat-tipo="entradas" ${estadoAberto.entradas ? 'open' : ''}>
          <summary class="cat-coluna-topo">
            <span class="cat-subgrupo-titulo"><svg class="seta-icone" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="var(--receita-text)" d="M12 20l-8-8h5V4h6v8h5z"/></svg> Receita</span>
            <span role="button" tabindex="0" class="h3-add h3-az" onclick="event.preventDefault();event.stopPropagation();ordenarAlfabetico('categoriasReceita')" title="Ordenar de A a Z">A→Z</span>
            <span role="button" tabindex="0" class="h3-add" onclick="event.preventDefault();event.stopPropagation();abrirNovaCategoria('entradas')" title="Nova categoria de receita">+</span>
          </summary>
          <div class="menu-list" id="categoriasReceitaList"></div>
        </details>
        <details class="cat-coluna" data-cat-tipo="saidas" ${estadoAberto.saidas ? 'open' : ''}>
          <summary class="cat-coluna-topo">
            <span class="cat-subgrupo-titulo"><svg class="seta-icone" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="var(--despesa-text)" d="M12 4l8 8h-5v8h-6v-8H4z"/></svg> Despesa</span>
            <span role="button" tabindex="0" class="h3-add h3-az" onclick="event.preventDefault();event.stopPropagation();ordenarAlfabetico('categoriasDespesa')" title="Ordenar de A a Z">A→Z</span>
            <span role="button" tabindex="0" class="h3-add" onclick="event.preventDefault();event.stopPropagation();abrirNovaCategoria('saidas')" title="Nova categoria de despesa">+</span>
          </summary>
          <div class="menu-list" id="categoriasDespesaList"></div>
        </details>
      </div>

      <div class="menu-section" data-sub="met" hidden>
        <div class="menu-secao-topo">
          <p class="menu-hint">Use as setinhas ▲▼ pra reordenar do jeito que você quiser — é essa ordem que aparece no dropdown do lançamento.</p>
          <div class="menu-acoes-linha">
            <button type="button" class="h3-add h3-az" onclick="ordenarAlfabetico('metodos')" title="Ordenar de A a Z">A→Z</button>
            <button type="button" class="h3-add" onclick="abrirNovoMetodo()" title="Nova forma de pagamento">+</button>
          </div>
        </div>
        <div class="menu-list" id="metodosList"></div>
      </div>


      <div class="menu-section" data-sub="fer" hidden>
        <div class="feriados-barra">
          <button type="button" class="mini-btn" data-fer-ano="-1">←</button>
          <span id="feriadosAno"></span>
          <button type="button" class="mini-btn" data-fer-ano="1">→</button>
          <select id="feriadosUf" name="feriados-uf" aria-label="UF dos feriados estaduais" class="mini-btn" title="Feriados estaduais desta UF ao sincronizar">
            <option value="">UF…</option>
            ${(typeof UFS_BR !== 'undefined' ? UFS_BR : []).map(u => `<option value="${u}">${u}</option>`).join('')}
          </select>
          <button type="button" class="mini-btn feriados-sync" id="btnSyncFeriados" title="Buscar feriados nacionais (e da UF) na Nager.Date">↻ sincronizar</button>
        </div>
        <p class="menu-hint">
          Nacionais e estaduais são oficiais: não podem ser apagados, só desativados.<br>
          Estaduais: os principais de cada UF (escolha a UF); "sincronizar" completa com a <a href="https://date.nager.at" target="_blank" rel="noopener"><em>Nager.Date</em></a>.<br>
          Municipais e avulsos você cadastra ao lado.
        </p>
        <div class="menu-acoes-linha">
          <button type="button" class="mini-btn" onclick="abrirNovoFeriado()" title="Novo feriado">+ Novo feriado</button>
        </div>
        ${['nacional', 'estadual', 'municipal'].map(cat => `
        <details class="fer-grupo" data-fer-cat="${cat}" ${estadoAberto[`fer-${cat}`] ? 'open' : ''}>
          <summary>
            <span class="fer-grupo-nome">${CATEGORIA_FERIADO_ROTULO[cat]}</span>
            <span class="fer-grupo-contagem" data-fer-count="${cat}">0</span>
          </summary>
          <div class="menu-list" id="feriados-${cat}-list"></div>
        </details>`).join('')}
      </div>

      <div class="menu-section" data-sub="of" hidden>
        <h3 class="dados-selecao-titulo">Notificações</h3>
        <div id="pluggyTelegramBox" class="pluggy-telegram"></div>

        <h3 class="dados-selecao-titulo">Pluggy</h3>
        <div class="menu-secao-topo">
          <p class="menu-hint">
            Conecta suas contas via <a href="https://pluggy.ai" target="_blank" rel="noopener">Pluggy</a> (open finance)
            e importa os lançamentos automaticamente, você confirma cada um antes de virar um lançamento de verdade,
            e possíveis duplicatas ficam avisadas à parte.
          </p>
          <div class="menu-acoes-linha">
            <button type="button" class="h3-add" id="btnConectarPluggy" title="Conectar nova conta">+</button>
          </div>
        </div>
        <div class="menu-list" id="pluggyContasList"></div>

        <div class="pluggy-toolbar">
          <div class="pluggy-toolbar-item pluggy-sync-periodo">
            <select id="syncMesPluggy" name="sync-mes" aria-label="Mês a sincronizar" class="pluggy-sync-mes"></select>
            <button type="button" id="syncAnoMenos" class="pluggy-sync-ano-seta" title="Ano anterior">◂</button>
            <span id="syncAnoPluggy" class="pluggy-sync-ano-valor"></span>
            <button type="button" id="syncAnoMais" class="pluggy-sync-ano-seta" title="Próximo ano">▸</button>
          </div>
          <div class="pluggy-toolbar-item pluggy-total">
            <span class="pluggy-toolbar-label">Total</span>
            <span class="pluggy-total-valor pluggy-total-receita" id="pluggyTotalReceita">+R$ 0</span>
            <span class="pluggy-total-valor pluggy-total-despesa" id="pluggyTotalDespesa">-R$ 0</span>
          </div>
          <div class="pluggy-toolbar-row2">
            <div class="pluggy-toolbar-item pluggy-rendimentos" role="group" aria-label="Rendimentos">
              <span class="pluggy-toolbar-label">Rendimentos</span>
              <button type="button" class="pluggy-toggle-opt" id="btnRendimentosAgrupar" data-rendimentos="agrupar">Agrupar</button>
              <button type="button" class="pluggy-toggle-opt active" id="btnRendimentosIgnorar" data-rendimentos="ignorar">Ignorar</button>
            </div>
            <div class="pluggy-contas-sync" id="pluggyContasSync" hidden></div>
            <div class="pluggy-toolbar-btns">
              <button type="button" class="btn-submit pluggy-toolbar-btn" id="btnSincronizarPluggy">↻ Sincronizar</button>
              <button type="button" class="mini-btn pluggy-toolbar-btn" id="btnLimparRevisaoPluggy">🧹 Limpar</button>
            </div>
          </div>
        </div>
        <div id="pluggyRevisaoLista" class="transacoes-lista"></div>
      </div>

      <div class="menu-section" data-sub="dados" hidden id="secDados"></div>

    </div>
  `;

  configurarSubtabsConfig();
  _aplicarSubConfig(subConfigAtiva);

  renderizarItemsMenu('Categoria', 'categoriasDespesaList', menus.categoriasDespesa, 'categoriasDespesa');
  renderizarItemsMenu('Categoria', 'categoriasReceitaList', menus.categoriasReceita, 'categoriasReceita');
  renderizarItemsMenu('Método', 'metodosList', menus.metodos, 'metodos');

  feriadosAnoView = (typeof estadoApp !== 'undefined' && estadoApp.mesAtual)
    ? estadoApp.mesAtual.getFullYear() : new Date().getFullYear();
  renderFeriados();
  const secFer = document.querySelector('.menu-section[data-sub="fer"]');
  if (secFer) secFer.addEventListener('click', onFeriadosClick);
  const selUf = document.getElementById('feriadosUf');
  if (selUf && typeof feriadosUF === 'function') {
    selUf.value = feriadosUF();
    selUf.addEventListener('change', () => {
      definirFeriadosUF(selUf.value);
      renderFeriados();
      if (typeof atualizarUI === 'function') atualizarUI();
    });
  }

  if (typeof iniciarPluggy === 'function') iniciarPluggy();
  if (typeof iniciarDados === 'function') iniciarDados();
}

let feriadosAnoView = new Date().getFullYear();

function _ferDataBR(iso) {
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/** (Re)desenha os 3 grupos de feriados do ano em exibição */
function renderFeriados() {
  const elAno = document.getElementById('feriadosAno');
  if (elAno) elAno.textContent = feriadosAnoView;

  ['nacional', 'estadual', 'municipal'].forEach(cat => {
    const lista = (typeof feriadosView === 'function') ? feriadosView(cat, feriadosAnoView) : [];
    const box = document.getElementById(`feriados-${cat}-list`);
    const cnt = document.querySelector(`[data-fer-count="${cat}"]`);
    if (cnt) cnt.textContent = lista.filter(f => f.ativo).length;
    if (!box) return;
    box.innerHTML = lista.length ? lista.map(f => `
      <div class="menu-item ${f.ativo ? 'ativo' : 'inativo'}">
        <div class="item-info"><div class="item-nome">${_ferDataBR(f.data)} · ${f.nome}</div></div>
        <div class="item-actions">
          <button class="mini-btn" data-fer-toggle="1" data-fer-id="${f.id || ''}" data-fer-iso="${f.data}" data-fer-cat="${cat}" data-fer-ativo="${f.ativo ? 1 : 0}">${f.ativo ? 'desativar' : 'ativar'}</button>
          ${f.oficial ? '' : `<button class="mini-btn" data-fer-del="${f.id}">apagar</button>`}
        </div>
      </div>`).join('') : `<p class="empty-text">Nenhum feriado ${CATEGORIA_FERIADO_ROTULO[cat].toLowerCase()} em ${feriadosAnoView}</p>`;
  });
}

async function onFeriadosClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.ferAno) {
    feriadosAnoView += Number(btn.dataset.ferAno);
    renderFeriados();
    return;
  }

  if (btn.id === 'btnSyncFeriados') {
    btn.disabled = true;
    const txt = btn.textContent;
    btn.textContent = '↻ ...';
    try {
      const n = await sincronizarFeriados([feriadosAnoView, feriadosAnoView + 1]);
      mostrarNotificacao(n ? `✓ ${n} feriado(s) adicionado(s)` : '✓ Já está tudo atualizado', 'sucesso');
      renderFeriados();
      if (typeof atualizarUI === 'function') atualizarUI();
    } catch (err) {
      mostrarNotificacao('❌ ' + (err.message || 'Falha na sincronização'), 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = txt;
    }
    return;
  }

  if (btn.dataset.ferToggle) {
    try {
      await definirFeriadoAtivo({
        id: btn.dataset.ferId || null,
        iso: btn.dataset.ferIso,
        origem: btn.dataset.ferCat,
        ativo: btn.dataset.ferAtivo !== '1'
      });
      renderFeriados();
      if (typeof atualizarUI === 'function') atualizarUI();
    } catch (_) { mostrarNotificacao('❌ Não foi possível salvar', 'erro'); }
    return;
  }

  if (btn.dataset.ferDel) {
    const nome = btn.closest('.menu-item')?.querySelector('.item-nome')?.textContent || 'este feriado';
    mostrarDialogo({
      titulo: 'Apagar feriado?',
      texto: `Remove <strong>${nome}</strong>.`,
      acoes: [
        { label: 'Cancelar' },
        { label: 'Apagar', primario: true, perigo: true, onClick: async () => {
            try {
              await apagarFeriado(btn.dataset.ferDel);
              renderFeriados();
              if (typeof atualizarUI === 'function') atualizarUI();
            } catch (_) { mostrarNotificacao('❌ Não foi possível apagar', 'erro'); }
        } }
      ]
    });
    return;
  }
}

/** Diálogo "Novo feriado" (categoria + data + nome) */
function abrirNovoFeriado() {
  const opts = ['nacional', 'estadual', 'municipal']
    .map(c => `<option value="${c}"${c === 'municipal' ? ' selected' : ''}>${CATEGORIA_FERIADO_ROTULO[c]}</option>`).join('');
  mostrarDialogo({
    titulo: 'Novo feriado',
    corpoHTML: `
      <div class="campo"><label for="dlgFerCat">Categoria</label>
        <select id="dlgFerCat">${opts}</select></div>
      <div class="campo"><label for="dlgFerData">Data (dia/mês de ${feriadosAnoView})</label>
        <input type="text" id="dlgFerData" inputmode="numeric" placeholder="dd/mm" maxlength="5" autocomplete="off"></div>
      <div class="campo"><label for="dlgFerNome">Nome</label>
        <input type="text" id="dlgFerNome" placeholder="Ex: Aniversário da cidade" maxlength="60"></div>`,
    acoes: [
      { label: 'Cancelar' },
      { label: 'Adicionar', primario: true, onClick: async (ov) => {
          const m = String(ov.querySelector('#dlgFerData').value).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
          const iso = m ? parseDataBR(`${m[1]}/${m[2]}/${feriadosAnoView}`) : '';
          const nome = ov.querySelector('#dlgFerNome').value.trim();
          const cat = ov.querySelector('#dlgFerCat').value;
          if (!iso || !nome) { mostrarNotificacao('❌ Informe uma data válida e o nome', 'erro'); return true; }
          try {
            await criarFeriado(iso, nome, cat);
            feriadosAnoView = Number(iso.slice(0, 4));
            renderFeriados();
            document.querySelector(`.fer-grupo[data-fer-cat="${cat}"]`)?.setAttribute('open', '');
            if (typeof atualizarUI === 'function') atualizarUI();
          } catch (err) {
            mostrarNotificacao('❌ ' + (err.message || 'Falha ao adicionar'), 'erro');
            return true;
          }
      } }
    ]
  });
  const inpData = document.querySelector('.dialogo-overlay #dlgFerData');
  if (inpData && typeof mascaraDataBR === 'function') {
    if (typeof ligarCampoData === 'function') ligarCampoData(inpData);
    inpData.addEventListener('input', () => mascaraDataBR(inpData));
  }
}

/** Aplica no DOM qual sub-aba está ativa (ou nenhuma, sub=null) — sem
 *  decidir toggle, só reflete o estado. Usada tanto pelo clique quanto por
 *  um re-render (recarregarMenus refaz o innerHTML inteiro), onde só
 *  precisa reaplicar o que já estava, sem fechar o que o usuário abriu. */
function _aplicarSubConfig(sub) {
  subConfigAtiva = sub;
  document.querySelectorAll('.menus-gerenciamento .subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.sub === sub));
  document.querySelectorAll('.menus-gerenciamento .menu-section').forEach(sec => {
    sec.hidden = sec.dataset.sub !== sub;
  });
}

/** Toggle: clicar na sub-aba já aberta fecha tudo (sub = null); clicar
 *  numa diferente troca. */
function mostrarSubConfig(sub) {
  _aplicarSubConfig(sub === subConfigAtiva ? null : sub);
}

/** Sub-abas da Configuração: Categorias / Métodos / Recorrências / ... */
function configurarSubtabsConfig() {
  const barra = document.querySelector('.menus-gerenciamento .subtabs');
  if (!barra) return;
  barra.addEventListener('click', e => {
    const btn = e.target.closest('.subtab');
    if (btn) mostrarSubConfig(btn.dataset.sub);
  });
}

/* ---------- Render ---------- */

function renderizarItemsMenu(tipo, containerId, itens, grupo) {
  const container = document.getElementById(containerId);
  if (!itens || !itens.length) {
    container.innerHTML = `<p class="empty-text">Nada cadastrado</p>`;
    container.onclick = null;
    return;
  }

  // Ordem manual do usuário (coluna "ordem"); item sem ordem definida vai pro fim.
  itens = [...itens].sort((a, b) => {
    const oa = a.ordem ?? Infinity, ob = b.ordem ?? Infinity;
    return oa - ob || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });

  container.innerHTML = itens.map((item, i) => {
    const statusClass = item.status === 'Ativo' ? 'ativo' : 'inativo';
    const statusLabel = item.status === 'Ativo' ? '✓ Ativo' : '✗ Inativo';

    let titulo = item.nome;
    let sub = '';
    if (tipo === 'Categoria') {
      sub = item.descricao || '';
    } else if (tipo === 'Método') {
      if (item.metodoKind === 'Crédito') {
        titulo = `Crédito - ${item.banco || '?'}`;
        const linha2 = [`Vira ${item.diaFechamento || '?'}`];
        if (item.melhorDiaCompra) linha2.push(`Melhor dia ${item.melhorDiaCompra}`);
        sub = `Vcto ${item.diaVencimento || '?'}<br>${linha2.join(' · ')}`;
      } else if (item.metodoKind === 'Dinheiro' || (!item.metodoKind && item.nome === 'Dinheiro')) {
        titulo = 'Dinheiro';
        sub = '';
      } else {
        // PIX/Débito — ou item legado com metodo_kind nulo (coluna adicionada
        // depois do seed original): sem isso, qualquer kind que não fosse
        // exatamente "Crédito" ou "PIX/Débito" caía aqui e virava "Dinheiro"
        // na tela, mesmo sendo outro método (o nome real no banco não mudava,
        // só a legenda mostrada aqui — por isso o dropdown do lançamento,
        // que usa rotuloMetodo(), continuava mostrando o nome certo).
        titulo = item.banco || item.nome || 'PIX/Débito';
        sub = item.banco ? (item.metodoKind || 'PIX/Débito') : '';
      }
    }

    // Dinheiro é método fixo: nunca pode ser removido nem editado (não tem
    // campo pra configurar mesmo), mas pode ser desativado como qualquer um.
    // "Estorno"/"Reembolso"/"Dinheiro" são categorias de receita fixas
    // ("Estorno"/"Reembolso" ligam o campo Método no formulário — ver
    // atualizarCampoMetodoReceita), então também não podem ser removidas
    // (editar o nome ainda é permitido).
    const semRemocao = (tipo === 'Método' && (item.metodoKind === 'Dinheiro' || item.nome === 'Dinheiro'))
        || (tipo === 'Categoria' && item.categoriaTipo === 'entradas'
            && (item.nome === CATEGORIA_ESTORNO || item.nome === CATEGORIA_REEMBOLSO || item.nome === CATEGORIA_DINHEIRO_RECEITA));

    const swatch = `<button class="cor-swatch" style="background:${corDoItemMenu(item)}"
        data-act="cor" data-tipo="${tipo}" data-id="${item.linha}" data-nome="${item.nome}" title="Cor do chip"></button>`;

    const setinhas = grupo ? `
        <div class="item-ordem">
          <button class="btn-icon btn-mini-seta" data-act="mover-cima" data-grupo="${grupo}" data-id="${item.linha}"
                  title="Mover pra cima" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn-icon btn-mini-seta" data-act="mover-baixo" data-grupo="${grupo}" data-id="${item.linha}"
                  title="Mover pra baixo" ${i === itens.length - 1 ? 'disabled' : ''}>▼</button>
        </div>` : '';

    const acoes = `
      <div class="item-actions">
        ${swatch}
        ${semRemocao ? '' : `<button class="btn-icon" data-act="editar" data-tipo="${tipo}" data-id="${item.linha}" title="Editar">✏️</button>`}
        <button class="btn-icon ${item.status === 'Ativo' ? 'btn-warning' : 'btn-success'}"
                data-act="${item.status === 'Ativo' ? 'desativar' : 'ativar'}" data-id="${item.linha}"
                title="${item.status === 'Ativo' ? 'Desativar' : 'Ativar'}">${item.status === 'Ativo' ? '⊘' : '↻'}</button>
        ${semRemocao ? '' : `<button class="btn-icon btn-danger" data-act="remover" data-id="${item.linha}" title="Remover">🗑️</button>`}
      </div>`;

    return `
      <div class="menu-item ${statusClass}" data-id="${item.linha}" data-tipo="${tipo}">
        ${setinhas}
        <div class="item-info">
          <div class="item-nome">${titulo}</div>
          ${sub ? `<div class="item-descricao">${sub}</div>` : ''}
        </div>
        <div class="item-status">${semRemocao ? 'fixo' : statusLabel}</div>
        ${acoes}
      </div>
    `;
  }).join('');

  container.onclick = onMenuListClick;
}

/* ---------- Ações (sem prompt/confirm nativos) ---------- */

function onMenuListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = Number(btn.dataset.id);
  const tipo = btn.dataset.tipo;
  const row = btn.closest('.menu-item');

  if (act === 'cor')         return abrirSeletorCor(btn);
  if (act === 'ativar')      return acaoMenu(() => ativarItemMenuAPI(id));
  if (act === 'desativar')   return acaoMenu(() => desativarItemMenuAPI(id));
  if (act === 'remover')     return confirmarRemocao(row, id);
  if (act === 'editar')      return abrirEdicaoInline(row, id, tipo);
  if (act === 'mover-cima')  return moverItemMenu(btn.dataset.grupo, id, -1);
  if (act === 'mover-baixo') return moverItemMenu(btn.dataset.grupo, id, 1);
}

/** Lista (já ordenada por "ordem") de um grupo reordenável. */
function _itensDoGrupo(grupo) {
  if (!menusAtual) return [];
  const base = grupo === 'categoriasReceita' ? menusAtual.categoriasReceita
    : grupo === 'categoriasDespesa' ? menusAtual.categoriasDespesa
    : grupo === 'metodos' ? menusAtual.metodos
    : [];
  return [...(base || [])].sort((a, b) => {
    const oa = a.ordem ?? Infinity, ob = b.ordem ?? Infinity;
    return oa - ob || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
}

/** Move um item uma posição pra cima (-1) ou pra baixo (+1) na lista, trocando a "ordem" com o vizinho. */
async function moverItemMenu(grupo, id, direcao) {
  const itens = _itensDoGrupo(grupo);
  const i = itens.findIndex(it => it.linha === id);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= itens.length) return;

  const a = itens[i], b = itens[j];
  const ordemA = a.ordem ?? (i + 1), ordemB = b.ordem ?? (j + 1);
  const ok = await salvarOrdemMenuAPI([
    { id: a.linha, ordem: ordemB },
    { id: b.linha, ordem: ordemA }
  ]);
  if (ok) await recarregarMenus();
}

/** Reordena um grupo inteiro em ordem alfabética (A→Z) e persiste. */
async function ordenarAlfabetico(grupo) {
  const itens = [...(_itensDoGrupo(grupo))]
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const atualizacoes = itens.map((item, i) => ({ id: item.linha, ordem: i + 1 }));
  const ok = await salvarOrdemMenuAPI(atualizacoes);
  if (ok) {
    mostrarNotificacao('Ordenado de A a Z', 'sucesso');
    await recarregarMenus();
  }
}

/** Seletor de cor do "chip" (paleta + cor livre). Único campo editável em Recorrências. */
function abrirSeletorCor(btn) {
  const tipo = btn.dataset.tipo;
  const nome = btn.dataset.nome || '';
  let id = Number(btn.dataset.id) || null;
  const corAtual = (btn.style.background || '').trim() || corPadraoChip(nome);

  const swatches = PALETA_CHIPS.map(c =>
    `<button type="button" class="cor-opcao" data-cor="${c}" style="background:${c}"></button>`).join('');

  mostrarDialogo({
    titulo: `Cor · ${nome}`,
    corpoHTML: `
      <div class="cor-grade">${swatches}</div>
      <div class="campo"><label for="dlgCorLivre">Cor personalizada</label>
        <input type="color" id="dlgCorLivre" value="${paraHex(corAtual)}"></div>`,
    acoes: [
      { label: 'Cancelar' },
      { label: 'Salvar', primario: true, onClick: async (ov) => {
          const sel = ov.querySelector('.cor-opcao.sel');
          const cor = sel ? sel.dataset.cor : ov.querySelector('#dlgCorLivre').value;
          // Recorrência sem linha ainda: cria antes
          if (!id && tipo === 'Recorrência') {
            const { data } = await sb.from('menu_itens')
              .insert({ tipo: 'Recorrência', nome, cor }).select('id').single();
            id = data && data.id;
          } else if (id) {
            await editarItemMenuAPI(id, { cor });
          }
          await recarregarMenus();
      } }
    ]
  });

  // seleção visual na grade
  const ov = document.querySelector('.dialogo-overlay');
  ov?.querySelectorAll('.cor-opcao').forEach(b => {
    b.addEventListener('click', () => {
      ov.querySelectorAll('.cor-opcao').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      const livre = ov.querySelector('#dlgCorLivre');
      if (livre) livre.value = paraHex(b.dataset.cor);
    });
  });
}

/** rgb()/hex -> "#rrggbb" (input type=color exige hex) */
function paraHex(c) {
  if (!c) return '#888888';
  if (c[0] === '#') return c.length === 4
    ? '#' + [...c.slice(1)].map(x => x + x).join('') : c.slice(0, 7);
  const m = c.match(/\d+/g);
  if (!m || m.length < 3) return '#888888';
  return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
}

async function acaoMenu(fn) {
  if (await fn()) recarregarMenus();
}

/** Confirmação de remoção via diálogo (sem confirm nativo) */
function confirmarRemocao(row, id) {
  const nome = row?.querySelector('.item-nome')?.textContent || 'este item';
  mostrarDialogo({
    titulo: 'Remover?',
    texto: `Remove <strong>${nome}</strong>. Não dá para desfazer.`,
    acoes: [
      { label: 'Cancelar' },
      { label: 'Remover', primario: true, perigo: true, onClick: () => acaoMenu(() => removerItemMenuAPI(id)) }
    ]
  });
}

/** Edição inline: troca a linha por campos + Salvar/Cancelar */
function abrirEdicaoInline(row, id, tipo) {
  const lista = tipo === 'Categoria' ? menusAtual?.categorias : menusAtual?.metodos;
  const item = (lista || []).find(i => i.linha === id);
  if (!item) return;
  const esc = s => String(s || '').replace(/"/g, '&quot;');

  if (tipo === 'Categoria') {
    row.innerHTML = `
      <div class="item-edit">
        <div class="campo"><label>Nome</label>
          <input type="text" class="edt-nome" name="nome" aria-label="Nome" value="${esc(item.nome)}"></div>
        <div class="campo"><label>Descrição</label>
          <input type="text" class="edt-desc" name="descricao" aria-label="Descrição" value="${esc(item.descricao)}"></div>
        <div class="item-edit-acoes">
          <button class="btn-add edt-salvar">Salvar</button>
          <button class="btn-icon edt-cancelar" title="Cancelar">✕</button>
        </div>
      </div>`;
    row.querySelector('.edt-cancelar').onclick = recarregarMenus;
    row.querySelector('.edt-salvar').onclick = async () => {
      const nome = row.querySelector('.edt-nome').value.trim();
      if (!nome) return mostrarNotificacao('Informe o nome', 'info');
      if (await editarItemMenuAPI(id, { nome, descricao: row.querySelector('.edt-desc').value.trim() }))
        recarregarMenus();
    };
    return;
  }

  // Método (PIX/Débito ou Crédito)
  const ehCredito = item.metodoKind === 'Crédito';
  row.innerHTML = `
    <div class="item-edit">
      <div class="campo"><label>Banco ${ehCredito ? '' : '<span class="opt">(opcional)</span>'}</label>
        <input type="text" class="edt-banco" name="banco" aria-label="Banco" value="${esc(item.banco)}"></div>
      ${ehCredito ? `
        <div class="campo"><label>Vencimento (dia)</label>
          <input type="text" class="edt-venc" name="vencimento" aria-label="Dia de vencimento" inputmode="numeric" maxlength="2" value="${item.diaVencimento || ''}"></div>
        <div class="campo"><label>Fechamento (dia) <span class="opt">(opcional)</span></label>
          <input type="text" class="edt-fech" name="fechamento" aria-label="Dia de fechamento" inputmode="numeric" maxlength="2" value="${item.diaFechamento || ''}"></div>
        <div class="campo"><label>Melhor dia <span class="opt">(opcional)</span></label>
          <input type="text" class="edt-melhor" name="melhor-dia" aria-label="Melhor dia de compra" inputmode="numeric" maxlength="2" value="${item.melhorDiaCompra || ''}"></div>
      ` : ''}
      <div class="item-edit-acoes">
        <button class="btn-add edt-salvar">Salvar</button>
        <button class="btn-icon edt-cancelar" title="Cancelar">✕</button>
      </div>
    </div>`;
  row.querySelector('.edt-cancelar').onclick = recarregarMenus;
  row.querySelectorAll('input[inputmode="numeric"]').forEach(inp =>
    inp.addEventListener('input', () => soNumeros(inp, 2)));
  row.querySelector('.edt-salvar').onclick = async () => {
    const banco = row.querySelector('.edt-banco').value.trim();
    if (ehCredito && !banco) return mostrarNotificacao('Informe o banco', 'info');
    // metodoKind pode ser nulo em itens antigos (coluna adicionada depois do
    // seed original) — sem esse fallback pro nome atual, salvar sem mudar o
    // banco gravava nome:null e apagava o método.
    const kind = item.metodoKind || item.nome;
    const campos = { banco, nome: banco ? `${kind} — ${banco}` : kind };
    if (ehCredito) {
      const fechRaw = row.querySelector('.edt-fech').value.trim();
      const fech = parseInt(fechRaw, 10);
      const venc = parseInt(row.querySelector('.edt-venc').value, 10);
      const melhorIn = parseInt(row.querySelector('.edt-melhor').value, 10);
      if (!(venc >= 1 && venc <= 31)) return mostrarNotificacao('Vencimento inválido', 'erro');
      const temFech = fech >= 1 && fech <= 31;
      if (fechRaw && !temFech) return mostrarNotificacao('Fechamento inválido', 'erro');
      campos.dia_vencimento = venc;
      campos.dia_fechamento = temFech ? fech : null;
      campos.melhor_dia_compra = melhorIn || (temFech ? sugerirMelhorDiaCompra(fech) : null) || null;
    }
    if (await editarItemMenuAPI(id, campos)) recarregarMenus();
  };
}

