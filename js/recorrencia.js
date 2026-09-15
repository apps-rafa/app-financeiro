/**
 * CÁLCULOS DE DIAS ÚTEIS E COMPETÊNCIA DE CARTÃO (front-end)
 */

// Feriados fixos nacionais (mês 1-12)
const FERIADOS_FIXOS = [
  { mes: 1, dia: 1 },   // Ano Novo
  { mes: 4, dia: 21 },  // Tiradentes
  { mes: 5, dia: 1 },   // Dia do Trabalho
  { mes: 9, dia: 7 },   // Independência
  { mes: 10, dia: 12 }, // N. Sra. Aparecida
  { mes: 11, dia: 2 },  // Finados
  { mes: 11, dia: 20 }, // Consciência Negra
  { mes: 12, dia: 25 }  // Natal
];

/** Date -> 'YYYY-MM-DD' (local) */
function formatarDataISO(data) {
  if (typeof data === 'string') return data.slice(0, 10);
  const d = new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** 'YYYY-MM-DD' -> Date local (sem shift de fuso) */
function parseDataLocal(dataStr) {
  const [ano, mes, dia] = String(dataStr).slice(0, 10).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/** Fim de semana ou feriado (nacional calculado + do usuário, via feriados.js)? */
function ehFimDeSemanaOuFeriado(data) {
  const dow = data.getDay();
  if (dow === 0 || dow === 6) return true;
  if (typeof ehFeriado === 'function') return ehFeriado(formatarDataISO(data));
  // fallback se feriados.js não carregou: só os fixos
  return FERIADOS_FIXOS.some(f => f.mes === data.getMonth() + 1 && f.dia === data.getDate());
}

/**
 * Dia útil mais próximo. Se já é dia útil, devolve a própria data.
 * Em empate (mesma distância antes/depois), escolhe o dia seguinte.
 */
function ajustarDiaUtil(data) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  if (!ehFimDeSemanaOuFeriado(d)) return d;
  for (let i = 1; i <= 15; i++) {
    const depois = new Date(d); depois.setDate(d.getDate() + i);
    if (!ehFimDeSemanaOuFeriado(depois)) return depois;
    const antes = new Date(d); antes.setDate(d.getDate() - i);
    if (!ehFimDeSemanaOuFeriado(antes)) return antes;
  }
  return d;
}

/** Primeiro dia útil >= a data dada (avança, nunca volta atrás) */
function proximoDiaUtil(data) {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  for (let i = 0; i < 20 && ehFimDeSemanaOuFeriado(d); i++) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Mês de competência de uma compra no cartão.
 * Compra antes do fechamento -> mês da compra; no dia ou depois -> mês seguinte.
 * Retorna 'YYYY-MM-01'.
 */
function competenciaDe(dataISO, diaFechamento) {
  const d = parseDataLocal(dataISO);
  let ano = d.getFullYear();
  let mes = d.getMonth(); // 0-11
  if (diaFechamento && d.getDate() >= diaFechamento) {
    mes += 1;
    if (mes > 11) { mes = 0; ano += 1; }
  }
  return `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

/** 'YYYY-MM-DD' de hoje (local) */
function hojeISO() {
  return formatarDataISO(new Date());
}

/** Data de vencimento: o dia informado na competência; se cair em fim de
 *  semana ou feriado, adia para o PRÓXIMO dia útil (nunca para trás). */
function dataVencimento(competenciaISO, dia) {
  const diaNum = parseInt(dia, 10);
  if (!competenciaISO || !diaNum) return '';
  const c = parseDataLocal(competenciaISO);
  const ultimo = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  return formatarDataISO(proximoDiaUtil(new Date(c.getFullYear(), c.getMonth(), Math.min(diaNum, ultimo))));
}

/** Soma `n` meses a uma data 'YYYY-MM-DD', preservando o dia (limitado ao fim do mês) */
function addMeses(dataISO, n) {
  const d = parseDataLocal(dataISO);
  let y = d.getFullYear();
  let m = d.getMonth() + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const ultimo = new Date(y, m + 1, 0).getDate();
  return formatarDataISO(new Date(y, m, Math.min(d.getDate(), ultimo)));
}

/**
 * Sugestão de "melhor dia de compra" a partir do dia de fechamento:
 * dia seguinte ao fechamento, ajustado para dia útil. Retorna número (1-31).
 */
function sugerirMelhorDiaCompra(diaFechamento) {
  const f = parseInt(diaFechamento, 10);
  if (!f) return '';
  const hoje = new Date();
  const alvo = new Date(hoje.getFullYear(), hoje.getMonth(), f + 1);
  return ajustarDiaUtil(alvo).getDate();
}
