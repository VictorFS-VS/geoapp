// frontend/src/modules/diagnostico/LanguageMapper.js

export const OPERATOR_LABELS = {
    'EQ': 'es igual a',
    'NEQ': 'no es igual a',
    'GT': 'es mayor que',
    'GTE': 'es mayor o igual que',
    'LT': 'es menor que',
    'LTE': 'es menor o igual que',
    'RANGE': 'se encuentra entre',
    'IN': 'es uno de los siguientes',
    'CONTAINS': 'incluye el valor',
};

// Mapa inverso para facilitar lectura en código si llegan alias humanos
const ALIAS_TO_CODE = {
    'es': 'EQ',
    'no_es': 'NEQ',
    'es_uno_de': 'IN',
    'mayor_a': 'GT',
    'menor_a': 'LT',
};

export const getHumanOperator = (op) => {
    // Si es un alias, lo convertimos a código primero
    const code = ALIAS_TO_CODE[op] || op;
    return OPERATOR_LABELS[code] || code;
};

export const getAvailableOperators = (tipo) => {
    const t = String(tipo || "").toUpperCase();
    if (t === 'NUMBER') return [
        { value: 'GT', label: 'es mayor a' },
        { value: 'GTE', label: 'es mayor o igual a' },
        { value: 'LT', label: 'es menor a' },
        { value: 'LTE', label: 'es menor o igual a' },
        { value: 'EQ', label: 'es igual a' },
        { value: 'NEQ', label: 'no es igual a' },
        { value: 'RANGE', label: 'se encuentra entre' },
    ];
    if (t === 'SELECT_SINGLE') return [
        { value: 'EQ', label: 'es exactamente' },
        { value: 'NEQ', label: 'no es exactamente' },
        { value: 'IN', label: 'es cualquiera de estos' },
    ];
    if (t === 'SELECT_MULTIPLE') return [
        { value: 'CONTAINS', label: 'incluye a' },
        { value: 'IN', label: 'es cualquiera de estos' },
    ];
    return [
        { value: 'EQ', label: 'es igual a' },
        { value: 'NEQ', label: 'no es igual a' },
        { value: 'CONTAINS', label: 'contiene el texto' },
    ];
};

export const mapQuestionType = (tipoOriginal) => {
    const t = String(tipoOriginal || "").toLowerCase().trim();
    if (['numero', 'integer', 'decimal', 'entero', 'float'].includes(t)) return 'NUMBER';
    if (['select', 'radio', 'semaforo', 'select_single'].includes(t)) return 'SELECT_SINGLE';
    if (['checkbox', 'multiselect', 'select_multiple'].includes(t)) return 'SELECT_MULTIPLE';
    return 'STRING';
};
